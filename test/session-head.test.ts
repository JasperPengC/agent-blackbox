/**
 * 会话头解析测试：部分加载（只读尾部）时，goal 要从文件头补出来。
 * 覆盖 DSH / Claude Code / Codex 三种用户消息格式，以及"系统注入不算 goal"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import { headLines, readSessionHead } from '../src/session-head.ts'
import type { SourceSession } from '../src/sources.ts'

function session(file: string, format: 'zstd-jsonl' | 'jsonl'): SourceSession {
  return {
    runtime: 'dsh',
    adapter: 'dsh',
    sessionId: 'session-test',
    project: 'demo',
    file,
    format,
    size: 1,
    mtime: Date.now(),
  }
}

function ndjson(lines: string[]): string {
  return lines.map((l) => `${l}\n`).join('')
}

test('DSH：从 agent/inbox/spliced 取用户消息，跳过 user-approval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-head-'))
  const file = join(dir, 's.jsonl')
  writeFileSync(
    file,
    ndjson([
      JSON.stringify({ type: 'session', version: 4, id: 'session-test', createdAt: 1700000000000 }),
      JSON.stringify({
        type: 'agent/inbox/spliced',
        data: { inserted: [{ content: [{ type: 'text', text: '系统提示：权限变更' }], source: { kind: 'user-approval' } }] },
      }),
      JSON.stringify({
        type: 'agent/inbox/spliced',
        data: { inserted: [{ content: [{ type: 'text', text: '把 payments 服务的重试改成退避' }], source: { kind: 'user' } }] },
      }),
    ]),
  )
  const head = readSessionHead(session(file, 'jsonl'))
  assert.equal(head?.goal, '把 payments 服务的重试改成退避')
  assert.equal(head?.startedAt, 1700000000000)
})

test('Claude Code：{"type":"user","message":{"content":[...]}}', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-head-'))
  const file = join(dir, 'c.jsonl')
  writeFileSync(
    file,
    ndjson([
      JSON.stringify({ type: 'summary', summary: 'x' }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: '重构登录模块' }] } }),
    ]),
  )
  assert.equal(readSessionHead(session(file, 'jsonl'))?.goal, '重构登录模块')
})

test('Codex：event_msg / user_message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-head-'))
  const file = join(dir, 'x.jsonl')
  writeFileSync(
    file,
    ndjson([JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '排查 OOM' } })]),
  )
  assert.equal(readSessionHead(session(file, 'jsonl'))?.goal, '排查 OOM')
})

test('多帧 zstd：能解出头部行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-head-'))
  const file = join(dir, 's.v4.jsonl.zstd')
  const frame1 = zstdCompressSync(Buffer.from(ndjson([JSON.stringify({ type: 'session', createdAt: 1700000000123 })])))
  const frame2 = zstdCompressSync(
    Buffer.from(ndjson([JSON.stringify({ type: 'message/user', data: { text: '多帧测试' } })])),
  )
  writeFileSync(file, Buffer.concat([frame1, frame2]))
  const head = readSessionHead(session(file, 'zstd-jsonl'))
  assert.equal(head?.goal, '多帧测试')
  assert.equal(head?.startedAt, 1700000000123)
  assert.equal(headLines(session(file, 'zstd-jsonl')).length, 2)
})

test('头部截断（goal 在 256KB 之后）→ goal 不猜，但 createdAt 仍可取', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-head-'))
  const file = join(dir, 'big.jsonl')
  const filler = JSON.stringify({ type: 'session', createdAt: 1 }) + '\n' + 'x'.repeat(300 * 1024) + '\n'
  writeFileSync(file, filler + JSON.stringify({ type: 'message/user', data: { text: '太靠后' } }) + '\n')
  const head = readSessionHead(session(file, 'jsonl'))
  assert.equal(head?.goal, undefined, '超出读取窗口的 goal 不应被猜出来')
  assert.equal(head?.startedAt, 1)
})
