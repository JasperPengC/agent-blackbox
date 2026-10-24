/**
 * 适配器测试 —— 用真实日志片段做回归。
 *
 * 约定：适配器的输出只断言"种类与关键字段"，不断言顺序细节 ——
 * 上游可以调整同一 batch 内的顺序，不应该让我们的测试变红。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { acpAdapter } from '../src/adapters/acp.ts'
import { claudeAdapter } from '../src/adapters/claude.ts'
import { codexAdapter } from '../src/adapters/codex.ts'
import { detectAdapter, getAdapter, ADAPTERS } from '../src/adapters/index.ts'
import type { Adapter, AdapterCtx } from '../src/adapters/types.ts'
import type { Draft } from '../src/schema.ts'

const CTX: AdapterCtx = { session: 's1', agent: 'coder', runtime: 'test' }

function run(adapter: Adapter, lines: string[], end?: 'done' | 'failed'): Draft[] {
  const out: Draft[] = []
  const inst = adapter.create(CTX, (d) => out.push(d))
  for (const l of lines) inst.onLine(l)
  if (end) inst.onEnd?.(end)
  return out
}

const kinds = (drafts: Draft[]): string[] => drafts.map((d) => d.kind)

test('claude: init / assistant / tool_result / result 全链路', () => {
  const lines = [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc',
      model: 'claude-opus-5.5',
      cwd: '/repo',
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '我看一下目录' },
          { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls -la' } },
        ],
        usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 80 },
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: 'a.ts b.ts' },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 120, output_tokens: 30 },
      result: '完成',
    }),
  ]
  const drafts = run(claudeAdapter, lines)
  const k = kinds(drafts)
  assert.ok(k.includes('session.start'))
  assert.ok(k.includes('tool.call'))
  assert.ok(k.includes('message.agent'))
  assert.ok(k.includes('tool.result'))
  assert.ok(k.includes('usage'))
  assert.ok(k.includes('session.end'))

  const start = drafts.find((d) => d.kind === 'session.start')
  assert.equal(start?.data?.['runtime'], 'claude-code')
  assert.equal(start?.data?.['model'], 'claude-opus-5.5')

  const call = drafts.find((d) => d.kind === 'tool.call')
  assert.equal(call?.call, 'toolu_1')
  assert.equal(call?.data?.['tool'], 'bash')

  const result = drafts.find((d) => d.kind === 'tool.result')
  assert.equal(result?.call, 'toolu_1')
  assert.equal(result?.data?.['ok'], true)

  const usage = drafts.filter((d) => d.kind === 'usage')
  assert.equal(usage.length, 2, '逐轮 token + result 成本各一条')
  assert.equal(usage[1]?.data?.['costUsd'], 0.0123)
})

test('claude: 失败的工具结果 is_error=true', () => {
  const drafts = run(claudeAdapter, [
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'command not found' },
        ],
      },
    }),
  ])
  const r = drafts.find((d) => d.kind === 'tool.result')
  assert.equal(r?.data?.['ok'], false)
  assert.equal(r?.data?.['error'], 'command not found')
})

test('acp: session/update 的文本、工具与完成状态', () => {
  const lines = [
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'ls', kind: 'execute' },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 's1',
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed' },
      },
    }),
  ]
  const drafts = run(acpAdapter, lines)
  assert.deepEqual(kinds(drafts).filter((k) => k !== 'session.start'), [
    'message.agent',
    'tool.call',
    'tool.result',
  ])
  assert.equal(drafts.find((d) => d.kind === 'tool.call')?.call, 'tc1')
  assert.equal(drafts.find((d) => d.kind === 'tool.result')?.data?.['ok'], true)
})

test('未知行必须落成 raw，不能丢', () => {
  for (const adapter of [claudeAdapter, acpAdapter, codexAdapter]) {
    const drafts = run(adapter, ['这不是 JSON', '{"foo":"bar"}'])
    assert.ok(
      drafts.some((d) => d.kind === 'raw'),
      `${adapter.id} 丢掉了无法识别的行`,
    )
  }
})

test('自动识别：claude 与 acp 不会互相误判', () => {
  const claudeLines = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x', model: 'm' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
  ]
  const acpLines = [
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's', update: { sessionUpdate: 'plan', entries: [] } },
    }),
  ]
  assert.equal(detectAdapter(claudeLines).id, 'claude')
  assert.equal(detectAdapter(acpLines).id, 'acp')
  assert.equal(detectAdapter(['随便一行日志', 'second line']).id, 'raw')
})

test('注册表：id 唯一，且能按 id 取回', () => {
  const ids = ADAPTERS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.ok(getAdapter(id), `取不到适配器 ${id}`)
})
