/**
 * Generate a synthetic DSH-format session used by the README recordings.
 *
 * The session is mock data: one parent (planner) plus two subagent child sessions
 * (coder, reviewer), written as multi-frame zstd JSONL exactly like a real
 * `~/.dsh/sessions` entry. Recording a session in this format makes the panel
 * header show the `DSH` runtime tag instead of `录制文件`.
 *
 * Usage:
 *   node scripts/make-dsh-demo.ts [--out fixtures/dsh-demo]
 *
 * Then open it:
 *   DSH_SESSIONS_DIR=fixtures/dsh-demo node src/cli.ts ui \
 *     fixtures/dsh-demo/--Users-demo-payments--/session-.../session.v4.jsonl.zstd
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { zstdCompressSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const outIndex = process.argv.indexOf('--out')
const OUT = resolve(ROOT_DIR, outIndex >= 0 ? process.argv[outIndex + 1] : 'fixtures/dsh-demo')

const PROJECT = '--Users-demo-payments--'
const PARENT = 'a1b2c3d4-0000-4000-8000-000000000001'
const CODER = 'a1b2c3d4-0000-4000-8000-000000000002'
const REVIEWER = 'a1b2c3d4-0000-4000-8000-000000000003'
const T0 = Date.parse('2026-10-24T09:00:00.000Z')

type Line = Record<string, unknown>
let seq = 0
const at = (type: string, time: number, data: Line): Line => ({ type, seq: seq++, time, data })

function writeSession(dir: string, lines: Line[]): void {
  mkdirSync(dir, { recursive: true })
  const rows = lines.map((l) => JSON.stringify(l))
  const parts: Buffer[] = []
  for (let i = 0; i < rows.length; i += 20) {
    parts.push(zstdCompressSync(Buffer.from(rows.slice(i, i + 20).join('\n') + '\n')))
  }
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(parts))
}

function toolLines(startTime: number, turn: number, spec: Array<{ tool: string; args: Line; out: string; dur: number; fail?: boolean }>): { lines: Line[]; end: number } {
  const lines: Line[] = []
  let time = startTime
  spec.forEach((s, i) => {
    const callId = `call_${turn}_${i}`
    lines.push(at('tool/call', time, { turn, step: i + 1, callId, name: s.tool, arguments: JSON.stringify(s.args) }))
    time += s.dur
    lines.push(at('tool/result', time, {
      turn, step: i + 1,
      message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: s.out }], isError: s.fail === true },
    }))
    time += 400
  })
  return { lines, end: time }
}

rmSync(OUT, { recursive: true, force: true })

// ── Parent session: planner ────────────────────────────────────────────────
const parent: Line[] = [
  { type: 'session', version: 4, id: `session-${PARENT}`, createdAt: T0, cwd: '/repo/payments', agentPreset: 'standard' },
  at('permission/preset', T0 + 10, { preset: 'workspace-write' }),
  at('request/header', T0 + 20, { header: { config: { provider: 'deepseek', model: 'deepseek-v4.1-flash' } } }),
  at('user/message', T0 + 40, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把 payments 服务的重试逻辑改成分级退避，并补齐测试' }] }),
  at('session/title', T0 + 60, { title: '把 payments 服务的重试逻辑改成分级退避，并补齐测试' }),
  at('turn/start', T0 + 80, { turn: 1 }),
  at('assistant/message', T0 + 120, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: '先定位重试逻辑：src/http/retry.ts；再拆分级退避的实现和测试。' }] }, usage: { inputTokens: 4200, outputTokens: 610, cacheReadTokens: 1800 } }),
]
const p1 = toolLines(T0 + 600, 1, [
  { tool: 'read', args: { path: 'src/http/retry.ts' }, out: 'export const MAX_RETRIES = 3', dur: 260 },
  { tool: 'bash', args: { command: "rg -n 'retry|backoff' src/" }, out: 'src/http/retry.ts:12: const MAX_RETRIES = 3', dur: 420 },
  { tool: 'edit', args: { path: 'src/http/retry.ts' }, out: 'ok (+18 -6)', dur: 460 },
  { tool: 'bash', args: { command: 'npm test -- retry' }, out: 'FAIL test/retry.spec.ts × retries exactly 3', dur: 3600, fail: true },
])
parent.push(...p1.lines)
parent.push(at('assistant/message', p1.end + 300, { turn: 1, step: 6, message: { role: 'assistant', content: [{ type: 'text', text: '重试测试挂了 2 个：断言的次数和间隔写死了，需要一并更新测试。' }] }, usage: { inputTokens: 12800, outputTokens: 1800, cacheReadTokens: 5200 } }))
parent.push(at('subagent/catalog', p1.end + 500, { childId: CODER, label: 'coder', mode: 'delegate' }))
parent.push(at('subagent/catalog', p1.end + 900, { childId: REVIEWER, label: 'reviewer', mode: 'delegate' }))

// ── Child session: coder ───────────────────────────────────────────────────
const coderT0 = T0 + 8000
const coder: Line[] = [
  { type: 'session', version: 4, id: `session-${CODER}`, createdAt: coderT0, cwd: '/repo/payments', agentPreset: 'standard' },
  at('request/header', coderT0 + 20, { header: { config: { provider: 'deepseek', model: 'gpt-6-sol' } } }),
  at('user/message', coderT0 + 40, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '实现分级退避：1s/2s/4s，上限 30s，并更新测试' }] }),
  at('turn/start', coderT0 + 60, { turn: 1 }),
]
const c1 = toolLines(coderT0 + 400, 1, [
  { tool: 'read', args: { path: 'src/http/retry.ts' }, out: 'export const MAX_RETRIES = 3', dur: 180 },
  { tool: 'write', args: { path: 'src/http/retry.ts' }, out: 'ok', dur: 320 },
  { tool: 'edit', args: { path: 'test/retry.spec.ts' }, out: 'ok (+42 -18)', dur: 390 },
  { tool: 'bash', args: { command: 'npm test -- retry' }, out: 'PASS test/retry.spec.ts (8 tests)', dur: 2800 },
  { tool: 'bash', args: { command: 'npm test' }, out: 'PASS 142 tests', dur: 3600 },
])
coder.push(...c1.lines)
coder.push(at('assistant/message', c1.end + 200, { turn: 1, step: 6, message: { role: 'assistant', content: [{ type: 'text', text: '分级退避已实现，测试全绿；上限 30s 用常量控制。' }] }, usage: { inputTokens: 8600, outputTokens: 1200, cacheReadTokens: 5200 } }))
coder.push(at('turn/end', c1.end + 400, { turn: 1, reason: { kind: 'completed' } }))

// ── Child session: reviewer ────────────────────────────────────────────────
const reviewerT0 = T0 + 16000
const reviewer: Line[] = [
  { type: 'session', version: 4, id: `session-${REVIEWER}`, createdAt: reviewerT0, cwd: '/repo/payments', agentPreset: 'standard' },
  at('request/header', reviewerT0 + 20, { header: { config: { provider: 'deepseek', model: 'claude-sonnet-5.5' } } }),
  at('user/message', reviewerT0 + 40, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '复核分级退避实现，重点看上限与幂等' }] }),
  at('turn/start', reviewerT0 + 60, { turn: 1 }),
]
const r1 = toolLines(reviewerT0 + 400, 1, [
  { tool: 'bash', args: { command: 'git diff' }, out: 'src/http/retry.ts | 24 ++++++++++++----', dur: 420 },
  { tool: 'read', args: { path: 'src/http/retry.ts' }, out: 'export const MAX_RETRIES = 3', dur: 200 },
  { tool: 'bash', args: { command: 'npm test -- retry' }, out: 'PASS test/retry.spec.ts (8 tests)', dur: 3000 },
])
reviewer.push(...r1.lines)
reviewer.push(at('assistant/message', r1.end + 200, { turn: 1, step: 4, message: { role: 'assistant', content: [{ type: 'reasoning', text: '上限 30s 有，但缺少抖动；幂等键没有校验。' }] }, usage: { inputTokens: 9800, outputTokens: 1600, cacheReadTokens: 7100 } }))
reviewer.push(at('assistant/message', r1.end + 500, { turn: 1, step: 5, message: { role: 'assistant', content: [{ type: 'text', text: '实现是对的，但有两个问题：上限没有抖动、幂等键未校验。' }] }, usage: { inputTokens: 2400, outputTokens: 420, cacheReadTokens: 1200 } }))
reviewer.push(at('turn/end', r1.end + 700, { turn: 1, reason: { kind: 'completed' } }))

parent.push(at('assistant/message', T0 + 22000, { turn: 1, step: 9, message: { role: 'assistant', content: [{ type: 'text', text: '复核完成：补上抖动与幂等校验后收尾。' }] }, usage: { inputTokens: 5200, outputTokens: 700, cacheReadTokens: 2400 } }))
parent.push(at('turn/end', T0 + 23000, { turn: 1, reason: { kind: 'completed' } }))

writeSession(join(OUT, PROJECT, `session-${PARENT}`), parent)
writeSession(join(OUT, PROJECT, CODER), coder)
writeSession(join(OUT, PROJECT, REVIEWER), reviewer)
process.stdout.write(`dsh demo fixture → ${OUT}\n`)
process.stdout.write(`  parent ${parent.length} events · coder ${coder.length} · reviewer ${reviewer.length}\n`)
