/**
 * DSH 子 agent 会话合并
 * ====================
 * 真实数据里子 agent 是独立会话目录（<project>/<childId>/session.v4.jsonl.zstd），
 * 父会话只有 subagent/catalog。这里用合成数据验证：
 *   · 子 agent 以独立 lane 出现（agent = label）
 *   · 子事件时间轴按 createdAt 差值对齐
 *   · 子会话的 run.start 等生命周期事件不会污染父状态
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { decodeSessionEvents } from '../src/session-source.ts'
import type { SourceSession } from '../src/sources.ts'

function zstdFile(path: string, lines: unknown[]): void {
  const text = lines.map((l) => `${JSON.stringify(l)}\n`).join('')
  writeFileSync(path, zstdCompressSync(Buffer.from(text)))
}

function makeProject(): { parent: SourceSession; childId: string } {
  const root = mkdtempSync(join(tmpdir(), 'bb-merge-'))
  const project = join(root, '--proj--')
  const childId = 'child-0001'
  const parentDir = join(project, 'session-parent')
  const childDir = join(project, childId)
  mkdirSync(parentDir, { recursive: true })
  mkdirSync(childDir, { recursive: true })

  zstdFile(join(parentDir, 'session.v4.jsonl.zstd'), [
    { type: 'session', version: 4, id: 'session-parent', createdAt: 1_000_000 },
    { type: 'tool/call', seq: 1, time: 1_001_000, data: { callId: 'c1', name: 'read_file', input: 'a.ts' } },
    {
      type: 'subagent/catalog',
      seq: 2,
      time: 1_002_000,
      data: { version: 0, childId, childCreatedAt: 1_005_000, mode: 'continuable', label: '核验助手' },
    },
    { type: 'tool/call', seq: 3, time: 1_003_000, data: { callId: 'c2', name: 'bash', input: 'ls' } },
  ])
  zstdFile(join(childDir, 'session.v4.jsonl.zstd'), [
    { type: 'session', version: 4, id: `session-${childId}`, createdAt: 1_005_000 },
    { type: 'run/start', seq: 0, time: 1_005_000, data: {} },
    { type: 'tool/call', seq: 1, time: 1_006_000, data: { callId: 'k1', name: 'grep', input: 'foo' } },
    { type: 'usage', seq: 2, time: 1_007_000, data: { in: 10, out: 5 } },
  ])

  return {
    parent: {
      runtime: 'dsh',
      adapter: 'dsh',
      sessionId: 'session-parent',
      project: 'proj',
      file: join(parentDir, 'session.v4.jsonl.zstd'),
      format: 'zstd-jsonl',
      size: 4096,
      mtime: Date.now(),
    },
    childId,
  }
}

test('子 agent 合并：独立 lane + 时间对齐 + 生命周期隔离', () => {
  const { parent, childId } = makeProject()
  const events = decodeSessionEvents(parent, true)
  const agents = [...new Set(events.map((e) => e.agent))]
  assert.ok(agents.includes('agent'), '父 agent 应在')
  assert.ok(agents.includes('核验助手'), '子 agent 应以 label 出现')

  // 子会话的 run.start 不应被合并进来
  assert.equal(events.filter((e) => e.kind === 'run.start' && e.agent === '核验助手').length, 0)

  // 时间对齐：子 tool.call 相对子会话 1000ms，父会话 1_000_000 → 绝对 1_006_000 → t=6000
  const childCall = events.find((e) => e.kind === 'tool.call' && e.agent === '核验助手')
  assert.ok(childCall, '子 agent 的工具调用应被合并')
  assert.equal(childCall!.t, 6000)
  assert.equal(childCall!.session, `session-${childId}`)

  // seq 重新编号且单调
  for (let i = 1; i < events.length; i++) assert.ok(events[i]!.seq > events[i - 1]!.seq)
})

test('没有 subagent/catalog 时不改变事件', () => {
  const root = mkdtempSync(join(tmpdir(), 'bb-merge2-'))
  const dir = join(root, 'p', 'session-x')
  mkdirSync(dir, { recursive: true })
  zstdFile(join(dir, 'session.v4.jsonl.zstd'), [
    { type: 'session', version: 4, createdAt: 1_000_000 },
    { type: 'tool/call', seq: 1, time: 1_001_000, data: { callId: 'c1', name: 'bash', input: 'ls' } },
  ])
  const events = decodeSessionEvents(
    {
      runtime: 'dsh',
      adapter: 'dsh',
      sessionId: 'session-x',
      project: 'p',
      file: join(dir, 'session.v4.jsonl.zstd'),
      format: 'zstd-jsonl',
      size: 1024,
      mtime: Date.now(),
    },
    true,
  )
  assert.ok(events.length >= 2)
  assert.equal(events.filter((e) => e.kind === 'subagent').length, 0)
  assert.equal([...new Set(events.map((e) => e.agent))].length, 1)
})
