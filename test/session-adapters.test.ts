/**
 * 原生会话适配器测试（Claude Code / Codex）。
 *
 * 重点钉住两个"只有跑真实数据才会发现"的行为：
 *   1. Claude Code 会把同一个 message.id 分多行写（逐块），token 不能重复计；
 *   2. Codex 的 token 用量独立成事件，要接上正确的模型。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { claudeCodeAdapter } from '../src/adapters/claude-code.ts'
import { codexSessionAdapter } from '../src/adapters/codex-session.ts'
import type { Draft } from '../src/schema.ts'

function run(adapter: typeof claudeCodeAdapter, lines: string[]): Draft[] {
  const out: Draft[] = []
  const inst = adapter.create({ session: 's', agent: 'a', runtime: 'x' }, (d) => out.push(d))
  for (const l of lines) inst.onLine(l)
  inst.onEnd?.('done')
  return out
}

const json = (o: unknown): string => JSON.stringify(o)

test('claude-code: 同一 message.id 的多行只计一次 token、只发一条发言', () => {
  const base = { sessionId: 'sess-1', uuid: 'u1', timestamp: '2026-10-22T15:00:00.000Z', cwd: '/repo' }
  const mid = 'msg_1'
  const lines = [
    json({ ...base, type: 'user', message: { role: 'user', content: '你好' } }),
    // 同一条 assistant 消息被拆成三行：thinking / text / tool_use，usage 只在最后一行
    json({ ...base, type: 'assistant', message: { id: mid, model: 'claude-opus-5.5', content: [{ type: 'thinking', thinking: '想一下' }], usage: { input_tokens: 0, output_tokens: 0 } } }),
    json({ ...base, type: 'assistant', message: { id: mid, model: 'claude-opus-5.5', content: [{ type: 'text', text: '我来看看' }], usage: { input_tokens: 0, output_tokens: 0 } } }),
    json({ ...base, type: 'assistant', message: { id: mid, model: 'claude-opus-5.5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 500 } } }),
    json({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts', is_error: false }] } }),
  ]
  const drafts = run(claudeCodeAdapter, lines)
  const usage = drafts.filter((d) => d.kind === 'usage')
  assert.equal(usage.length, 1, '同一条消息只能记一次用量')
  assert.equal(usage[0]!.data?.['in'], 100)
  assert.equal(usage[0]!.data?.['cached'], 500)
  assert.equal(drafts.filter((d) => d.kind === 'message.agent').length, 1, '发言不应被拆成碎片')
  assert.equal(drafts.filter((d) => d.kind === 'tool.call').length, 1)
  assert.equal(drafts.filter((d) => d.kind === 'tool.result').length, 1)
})

test('claude-code: 没时间戳的行先缓冲，拿到锚点后仍能对齐相对时间', () => {
  const lines = [
    json({ type: 'attachment' }), // 无 timestamp，也不产生事件
    json({ type: 'user', sessionId: 's', uuid: 'u', timestamp: '2026-10-22T15:00:10.000Z', message: { role: 'user', content: 'hi' } }),
    json({ type: 'user', sessionId: 's', uuid: 'u2', timestamp: '2026-10-22T15:00:25.000Z', message: { role: 'user', content: '再说一句' } }),
  ]
  const drafts = run(claudeCodeAdapter, lines)
  assert.equal(drafts.find((d) => d.kind === 'run.start')!.t, 0, 'run.start 必须在 0 时刻')
  const users = drafts.filter((d) => d.kind === 'message.user')
  assert.equal(users.length, 2, '字符串 content 不能被丢掉')
  assert.equal(users[0]!.t, 0)
  assert.equal(users[1]!.t, 15_000, '第二条消息应当落在第 15 秒（相对锚点）')
})

test('codex: response_item 与 token_usage_record 映射正确', () => {
  const t = (s: string): string => `2026-10-22T15:0${s}.000Z`
  const lines = [
    json({ timestamp: t('0:00'), ordinal: 0, type: 'session_meta', payload: { session_id: 'th-1', cwd: '/repo', model_provider: 'custom' } }),
    json({ timestamp: t('0:01'), ordinal: 1, type: 'turn_context', payload: { model: 'gpt-5-codex', cwd: '/repo' } }),
    json({ timestamp: t('0:02'), ordinal: 2, type: 'response_item', payload: { type: 'function_call', name: 'shell', namespace: 'mcp', arguments: '{"command":"ls"}', call_id: 'c1' } }),
    json({ timestamp: t('0:03'), ordinal: 3, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'a.ts' }] } }),
    json({ timestamp: t('0:04'), ordinal: 4, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '看完了' }] } }),
    json({ timestamp: t('0:05'), ordinal: 5, type: 'token_usage_record', payload: { usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } } }),
    json({ timestamp: t('0:06'), ordinal: 6, type: 'event_msg', payload: { type: 'token_count' } }),
  ]
  const drafts = run(codexSessionAdapter, lines)
  assert.equal(drafts.find((d) => d.kind === 'session.start' && d.data?.['model'] === 'gpt-5-codex') !== undefined, true)
  const call = drafts.find((d) => d.kind === 'tool.call')!
  assert.equal(call.call, 'c1')
  assert.equal(call.data?.['tool'], 'mcp.shell')
  const result = drafts.find((d) => d.kind === 'tool.result')!
  assert.equal(result.data?.['output'], 'a.ts')
  const usage = drafts.find((d) => d.kind === 'usage')!
  assert.equal(usage.data?.['in'], 1000)
  assert.equal(usage.data?.['cached'], 800)
  assert.equal(usage.data?.['out'], 50)
  // event_msg 是纯噪声，不应落成事件
  assert.equal(drafts.filter((d) => d.kind === 'raw').length, 0)
})
