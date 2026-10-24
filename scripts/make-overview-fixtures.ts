/**
 * 生成"多 runtime"演示数据（合成，不含任何真实会话内容）。
 *
 * 用途：
 *   1. README 的总览截图必须用合成数据 —— 真实会话里有项目路径、会话 id、代码片段；
 *   2. 让 `blackbox overview` 在没有装任何 agent 的机器上也能演示。
 *
 * 运行：node scripts/make-overview-fixtures.ts
 * 然后：DSH_SESSIONS_DIR=... CLAUDE_PROJECTS_DIR=... CODEX_SESSIONS_DIR=... blackbox overview
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../fixtures/multi-runtime/', import.meta.url))
rmSync(root, { recursive: true, force: true })

let base = Date.parse('2026-10-21T09:00:00.000Z')
const tick = (ms: number): string => new Date((base += ms)).toISOString()

// ── DSH ────────────────────────────────────────────────────────────────────
type Frame = string[]
function writeDsh(project: string, session: string, goal: string, model: string, tools: number, tokens: [number, number, number]): void {
  const dir = join(root, 'dsh', project, session)
  mkdirSync(dir, { recursive: true })
  const t0 = Date.parse('2026-10-21T09:00:00.000Z')
  const lines = [
    JSON.stringify({ type: 'session', version: 4, id: session, createdAt: t0, cwd: `/repo/${project}`, agentPreset: 'standard' }),
    JSON.stringify({ type: 'permission/preset', seq: 0, time: t0 + 10, data: { preset: 'workspace-write' } }),
    JSON.stringify({ type: 'request/header', seq: 1, time: t0 + 20, data: { header: { config: { provider: 'deepseek', model } } } }),
  ]
  let seq = 2
  let time = t0 + 30
  for (let i = 0; i < tools; i++) {
    time += 1500 + (i % 5) * 400
    lines.push(JSON.stringify({ type: 'tool/call', seq: seq++, time, data: { turn: 1, step: i + 1, callId: `call_${i}`, name: i % 4 === 0 ? 'edit' : 'bash', arguments: JSON.stringify(i % 4 === 0 ? { path: `src/mod-${i}.ts` } : { command: `npm test -- ${i}` }) } }))
    time += 900 + (i % 3) * 700
    lines.push(JSON.stringify({ type: 'tool/result', seq: seq++, time, data: { turn: 1, step: i + 1, message: { role: 'tool', toolCallId: `call_${i}`, content: [{ type: 'text', text: 'ok' }], isError: i % 9 === 4 } } }))
    if (i % 3 === 0) {
      lines.push(JSON.stringify({ type: 'assistant/message', seq: seq++, time, data: { turn: 1, step: i + 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: `第 ${i} 步：先看失败用例再改` }] }, usage: { inputTokens: tokens[0] / tools, outputTokens: tokens[1] / tools, cacheReadTokens: tokens[2] / tools } } }))
    }
  }
  time += 2000
  lines.push(JSON.stringify({ type: 'user/message', seq: seq++, time: t0 + 25, data: { content: [{ type: 'text', text: goal }], source: { kind: 'user' }, role: 'user' } }))
  lines.push(JSON.stringify({ type: 'turn/end', seq: seq++, time, data: { turn: 1, reason: { kind: 'completed' } } }))

  // 多帧：每 20 行一帧，模拟真实追加写
  const parts: Buffer[] = []
  for (let i = 0; i < lines.length; i += 20) {
    parts.push(zstdCompressSync(Buffer.from(lines.slice(i, i + 20).join('\n') + '\n')))
  }
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(parts))
}

writeDsh('--Users-demo-Documents-payments--', 'session-8f2c41aa-1b3e-4a52-9e11-0a7c2b31d001', '把 payments 服务的重试逻辑改成分级退避，并补齐测试', 'deepseek-v4.1-flash', 34, [820_000, 46_000, 610_000])
writeDsh('--Users-demo-Documents-payments--', 'session-2d10be77-55aa-4c9e-8b02-1f9e4477c002', '排查 CI 上偶发的 flaky 测试', 'deepseek-v4.1-flash', 12, [210_000, 12_000, 150_000])
writeDsh('--Users-demo-Documents-infra--', 'session-b31c9d54-7f02-4a11-8cf0-93aa2e6c5003', '把部署脚本从 bash 迁到 TypeScript', 'deepseek-v4-pro', 58, [1_480_000, 92_000, 1_120_000])

// ── Claude Code ────────────────────────────────────────────────────────────
function writeClaude(slug: string, session: string, model: string, turns: number, tokens: [number, number, number]): void {
  const dir = join(root, 'claude', slug)
  mkdirSync(dir, { recursive: true })
  let ts = Date.parse('2026-10-20T14:00:00.000Z')
  const step = (): string => new Date((ts += 4200)).toISOString()
  const lines: string[] = [
    JSON.stringify({ type: 'custom-title', customTitle: '把 monorepo 的构建缓存做对', sessionId: session }),
  ]
  for (let i = 0; i < turns; i++) {
    lines.push(JSON.stringify({ type: 'user', sessionId: session, uuid: `u-${i}`, timestamp: step(), cwd: '/Users/demo/work', message: { role: 'user', content: i === 0 ? '把 monorepo 的构建缓存做对' : `再看第 ${i} 个包` } }))
    // Claude Code 会把同一 message.id 拆成多行写 —— 演示数据也照这个形状来
    const mid = `msg_${i}`
    lines.push(JSON.stringify({ type: 'assistant', sessionId: session, uuid: `a-${i}-0`, timestamp: step(), message: { id: mid, model, content: [{ type: 'thinking', thinking: '先看构建配置' }], usage: { input_tokens: 0, output_tokens: 0 } } }))
    lines.push(JSON.stringify({ type: 'assistant', sessionId: session, uuid: `a-${i}-1`, timestamp: step(), message: { id: mid, model, content: [{ type: 'text', text: '我先读一下 turbo.json' }], usage: { input_tokens: 0, output_tokens: 0 } } }))
    lines.push(JSON.stringify({ type: 'assistant', sessionId: session, uuid: `a-${i}-2`, timestamp: step(), message: { id: mid, model, content: [{ type: 'tool_use', id: `t-${i}`, name: 'Read', input: { file_path: 'turbo.json' } }], usage: { input_tokens: tokens[0] / turns, output_tokens: tokens[1] / turns, cache_read_input_tokens: tokens[2] / turns } } }))
    lines.push(JSON.stringify({ type: 'user', sessionId: session, uuid: `r-${i}`, timestamp: step(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${i}`, content: '{"pipeline":{}}', is_error: false }] } }))
  }
  writeFileSync(join(dir, `${session}.jsonl`), lines.join('\n') + '\n')
}

writeClaude('-Users-demo-work', '7c1f9e02-33aa-4d51-9c11-5b02aa8f6a01', 'claude-sonnet-5.5', 18, [2_450_000, 210_000, 1_980_000])
writeClaude('-Users-demo-work', 'a41b7c66-1d02-4b8e-9f31-2cbb10aa7b02', 'claude-opus-5.5', 7, [660_000, 88_000, 520_000])

// ── Codex ──────────────────────────────────────────────────────────────────
function writeCodex(day: string, id: string, model: string, calls: number, tokens: [number, number, number]): void {
  const dir = join(root, 'codex', '2026', '10', day)
  mkdirSync(dir, { recursive: true })
  let ts = Date.parse(`2026-10-${day}T08:00:00.000Z`)
  const step = (ms: number): string => new Date((ts += ms)).toISOString()
  const lines: string[] = [
    JSON.stringify({ timestamp: step(0), ordinal: 0, type: 'session_meta', payload: { session_id: id, cwd: '/Users/demo/api', model_provider: 'custom', cli_version: '0.163.0' } }),
    JSON.stringify({ timestamp: step(10), ordinal: 1, type: 'turn_context', payload: { model, cwd: '/Users/demo/api' } }),
  ]
  let ord = 2
  for (let i = 0; i < calls; i++) {
    lines.push(JSON.stringify({ timestamp: step(900), ordinal: ord++, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: `pnpm test ${i}` }), call_id: `c-${i}` } }))
    lines.push(JSON.stringify({ timestamp: step(1300), ordinal: ord++, type: 'response_item', payload: { type: 'function_call_output', call_id: `c-${i}`, output: [{ type: 'input_text', text: 'ok' }] } }))
    lines.push(JSON.stringify({ timestamp: step(200), ordinal: ord++, type: 'token_usage_record', payload: { usage: { input_tokens: tokens[0] / calls, cached_input_tokens: tokens[2] / calls, output_tokens: tokens[1] / calls } } }))
    if (i % 5 === 0) lines.push(JSON.stringify({ timestamp: step(100), ordinal: ord++, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `第 ${i} 组测试跑完了` }] } }))
  }
  writeFileSync(join(dir, `rollout-2026-10-${day}T08-00-00-${id}.jsonl`), lines.join('\n') + '\n')
}

writeCodex('20', '01a15aaa-1111-7be1-b6e6-a61c22954f01', 'gpt-5-codex', 26, [3_100_000, 140_000, 2_700_000])
writeCodex('21', '01a15bbb-2222-7be1-b6e6-a61c22954f02', 'gpt-6-sol', 11, [1_250_000, 96_000, 980_000])

process.stdout.write(`✓ fixtures/multi-runtime/  DSH 3 · Claude Code 2 · Codex 2\n`)
