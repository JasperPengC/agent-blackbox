/**
 * DSH 实时链路测试。
 *
 * 这条链路是"有用"的全部来源，所以每一环都要钉死：
 *   多帧 zstd 解码 → 时间锚点 → 事件映射 → 增量索引等价性
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zstdCompressSync } from 'node:zlib'

import { decodeFrames, SessionTailer } from '../src/live.ts'
import { dshAdapter } from '../src/adapters/dsh.ts'
import { buildIndex, extendIndex, seek, fold } from '../src/projector.ts'
import type { Draft } from '../src/schema.ts'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const line = (o: Record<string, unknown>): string => JSON.stringify(o)

/** 造一段贴近真实 DSH 会话的日志（session 行没有 time，只有 createdAt） */
function sampleLines(): string[] {
  const t0 = 1_700_000_000_000
  return [
    line({ type: 'session', version: 4, id: 'session-test', createdAt: t0, cwd: '/repo', agentPreset: 'standard' }),
    line({ type: 'permission/preset', seq: 0, time: t0 + 10, data: { preset: 'workspace-write' } }),
    line({ type: 'turn/start', seq: 1, time: t0 + 20, data: { turn: 1 } }),
    line({
      type: 'user/message',
      seq: 2,
      time: t0 + 30,
      data: { content: [{ type: 'text', text: '帮我修个 bug' }], source: { kind: 'user' }, role: 'user', id: 'u1' },
    }),
    line({
      type: 'request/header',
      seq: 3,
      time: t0 + 40,
      data: { header: { config: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } } },
    }),
    line({
      type: 'assistant/message',
      seq: 4,
      time: t0 + 900,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '先看下测试' },
            { type: 'text', text: '我来跑一下测试' },
            { type: 'tool-call', id: 'c1' },
          ],
        },
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300 },
      },
    }),
    line({ type: 'tool/call', seq: 5, time: t0 + 950, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"npm test"}' } }),
    line({
      type: 'tool/result',
      seq: 6,
      time: t0 + 4200,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '1 failing' }], isError: true },
      },
    }),
    line({ type: 'job/registered', seq: 7, time: t0 + 951, data: { jobId: 'b1', kind: 'bash' } }),
    line({ type: 'turn/end', seq: 8, time: t0 + 5000, data: { turn: 1, reason: { kind: 'completed' } } }),
    line({ type: 'session/title', seq: 9, time: t0 + 5100, data: { title: '修 bug', source: { kind: 'fallback' } } }),
  ]
}

function runAdapter(lines: string[]): Draft[] {
  const out: Draft[] = []
  const inst = dshAdapter.create({ session: 's', agent: 'lead', runtime: 'dsh' }, (d) => out.push(d))
  for (const l of lines) inst.onLine(l)
  return out
}

test('decodeFrames: 多帧拼接能一次解完', () => {
  const f1 = zstdCompressSync(Buffer.from('{"a":1}\n{"a":2}\n'))
  const f2 = zstdCompressSync(Buffer.from('{"a":3}\n'))
  const buf = Buffer.concat([f1, f2])
  const r = decodeFrames(buf)
  assert.equal(r.lines.length, 3)
  assert.equal(r.consumed, buf.length)
  assert.equal(r.partial, false)
})

test('decodeFrames: 最后一帧只写了一半时不推进偏移量', () => {
  const f1 = zstdCompressSync(Buffer.from('{"a":1}\n'))
  const f2 = zstdCompressSync(Buffer.from('{"a":2}\n{"a":3}\n'))
  const whole = Buffer.concat([f1, f2])
  // 砍掉第二帧的大半：追加写读到的半帧通常就是这个形态
  const truncated = whole.subarray(0, f1.length + Math.floor(f2.length * 0.6))
  const r = decodeFrames(truncated)
  assert.equal(r.partial, true)
  assert.equal(r.consumed, f1.length, '只应消费完整的第一帧')
  assert.equal(r.lines.length, 1)
})

test('SessionTailer: 追加写后能读到新增行（增量，不重读）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-tail-'))
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, zstdCompressSync(Buffer.from('{"a":1}\n')))
  const tailer = new SessionTailer(file)
  assert.deepEqual(tailer.poll(), ['{"a":1}'])
  assert.deepEqual(tailer.poll(), [])
  appendFileSync(file, zstdCompressSync(Buffer.from('{"a":2}\n{"a":3}\n')))
  assert.deepEqual(tailer.poll(), ['{"a":2}', '{"a":3}'])
  rmSync(dir, { recursive: true, force: true })
})

test('dsh: 时间锚点正确（session 行没有 time 时不能退化成绝对时间戳）', () => {
  const drafts = runAdapter(sampleLines())
  const start = drafts.find((d) => d.kind === 'run.start')
  assert.equal(start?.t, 0)
  const sessionStart = drafts.find((d) => d.kind === 'session.start')
  assert.ok(sessionStart && typeof sessionStart.t === 'number')
  assert.ok((sessionStart!.t as number) < 1000, `session.start 的 t 应该是相对时间，实际 ${sessionStart!.t}`)
  const last = drafts[drafts.length - 1]!
  assert.ok((last.t as number) < 60_000, `相对时间轴不该超过 1 分钟，实际 ${last.t}`)
})

test('dsh: 事件映射与去重（tool-call 块不重复落地、job/* 不产生噪声）', () => {
  const drafts = runAdapter(sampleLines())
  const kinds = drafts.map((d) => d.kind)
  assert.equal(kinds.filter((k) => k === 'tool.call').length, 1, 'tool/call 只应出现一次')
  assert.equal(kinds.filter((k) => k === 'tool.result').length, 1)
  assert.equal(kinds.filter((k) => k === 'run.start').length, 1)
  // job/registered 与 tool 生命周期重复，不应变成 raw；只有配置类内部遥测保留"发生过"
  const rawLines = drafts.filter((d) => d.kind === 'raw').map((d) => String(d.data?.['line'] || ''))
  assert.equal(rawLines.filter((l) => l.startsWith('job/')).length, 0, 'job/* 不该落成 raw 噪声')
  assert.ok(rawLines.includes('permission/preset'), '内部遥测应当保留"发生过"的痕迹')

  const call = drafts.find((d) => d.kind === 'tool.call')!
  assert.equal(call.call, 'c1')
  assert.equal(call.data?.['tool'], 'bash')
  assert.deepEqual(call.data?.['input'], { command: 'npm test' })

  const result = drafts.find((d) => d.kind === 'tool.result')!
  assert.equal(result.data?.['ok'], false)
  assert.equal(result.data?.['error'], '1 failing')
})

test('dsh: model / provider 从 request/header 补发，不改变会话状态', () => {
  const drafts = runAdapter(sampleLines())
  const starts = drafts.filter((d) => d.kind === 'session.start')
  assert.ok(starts.length >= 2, '应当补发一次带 model 的 session.start')
  assert.equal(starts[starts.length - 1]!.data?.['model'], 'deepseek-v4.1-flash')
  assert.equal(starts[starts.length - 1]!.data?.['provider'], 'opencode-go')
})

test('dsh: 审批通知不算用户发言（否则任务目标会被系统提示污染）', () => {
  const t0 = 1_700_000_000_000
  const lines = [
    line({ type: 'session', version: 4, id: 's', createdAt: t0 }),
    line({
      type: 'user/message',
      seq: 0,
      time: t0 + 5,
      data: { content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never"' }], source: { kind: 'user-approval' } },
    }),
    line({
      type: 'user/message',
      seq: 1,
      time: t0 + 10,
      data: { content: [{ type: 'text', text: '我想要开发一个智能体' }], source: { kind: 'user' } },
    }),
  ]
  const drafts = runAdapter(lines)
  const users = drafts.filter((d) => d.kind === 'message.user')
  assert.equal(users.length, 1)
  assert.equal(users[0]!.data?.['text'], '我想要开发一个智能体')
})

test('extendIndex: 增量扩展的结果必须等于一次性全量构建', () => {
  const t0 = 1_700_000_000_000
  const lines: string[] = [line({ type: 'session', version: 4, id: 's', createdAt: t0 })]
  for (let i = 0; i < 40; i++) {
    lines.push(
      line({ type: 'turn/start', seq: i * 4, time: t0 + i * 1000, data: { turn: i + 1 } }),
      line({ type: 'tool/call', seq: i * 4 + 1, time: t0 + i * 1000 + 100, data: { callId: `c${i}`, name: 'bash', arguments: '{"command":"ls"}' } }),
      line({ type: 'tool/result', seq: i * 4 + 2, time: t0 + i * 1000 + 400, data: { message: { toolCallId: `c${i}`, content: [{ type: 'text', text: 'ok' }] } } }),
      line({ type: 'usage', seq: i * 4 + 3, time: t0 + i * 1000 + 500, data: {} }),
    )
  }
  const drafts = runAdapter(lines)
  // 用 recoder 语义补齐 seq/t：这里直接构造事件
  const events = drafts.map((d, i) => ({
    v: 1,
    seq: i,
    t: typeof d.t === 'number' ? d.t : i * 10,
    run: 's',
    session: 's',
    agent: 'lead',
    kind: d.kind,
    ...(d.call ? { call: d.call } : {}),
    data: d.data ?? {},
  }))
  const half = Math.floor(events.length / 2)
  const full = buildIndex(events)
  const incremental = extendIndex(buildIndex(events.slice(0, half)), events.slice(half))

  const a = seek(full, full.duration)
  const b = seek(incremental, incremental.duration)
  assert.equal(incremental.events.length, full.events.length)
  assert.deepEqual(
    { tools: incremental.derived.tools, kinds: incremental.derived.kinds },
    { tools: full.derived.tools, kinds: full.derived.kinds },
  )
  assert.equal(b.stats.events, a.stats.events)
  assert.equal(b.stats.toolCalls, a.stats.toolCalls)
  assert.equal(incremental.spans.length, full.spans.length)
  assert.equal(incremental.duration, full.duration)
  // 历史段也要能正确回溯（检查点由增量路径补充）
  const mid = seek(incremental, Math.floor(incremental.duration / 2))
  const midFull = seek(full, Math.floor(full.duration / 2))
  assert.equal(mid.stats.toolCalls, midFull.stats.toolCalls)
})
