/**
 * 生成内置示例：一次"三 agent 协作修 bug"的完整任务流。
 *
 * 为什么用脚本生成而不是手写 fixture：
 *   · 时间轴可以精确编排（dt 累加），保证叙事连贯；
 *   · 想加一个"reviewer 被 coder 阻塞 60s"的场景只改一行；
 *   · fixture 本身可读，是 schema 的最佳文档。
 *
 * 运行：node scripts/make-fixture.ts
 */

import { writeNdjson } from '../src/ndjson.ts'
import { SCHEMA_VERSION, type Event, type Kind } from '../src/schema.ts'

const RUN = 'mission-payments-retry'
const WALL_START = '2026-10-21T09:14:03.000Z'

const S = {
  planner: 'sess-planner',
  coder: 'sess-coder',
  reviewer: 'sess-reviewer',
} as const

let t = 0
let seq = 0
const events: Event[] = []

type Push = {
  /** 距上一条事件的毫秒数 */
  dt?: number
  session?: string
  agent?: string
  call?: string
  data?: Record<string, unknown>
}

function push(kind: Kind, p: Push = {}): void {
  t += p.dt ?? 0
  const e: Event = {
    v: SCHEMA_VERSION,
    seq: seq++,
    t,
    run: RUN,
    session: p.session ?? '',
    agent: p.agent ?? '',
    kind,
    data: p.data ?? {},
  }
  if (p.call) e.call = p.call
  events.push(e)
}

// ── 任务开始 ────────────────────────────────────────────────────────────────
push('run.start', { data: { wall: WALL_START, goal: '把 payments 服务的重试逻辑改成分级退避，并补齐测试' } })
push('session.start', {
  dt: 240,
  session: S.planner,
  agent: 'planner',
  data: { runtime: 'claude-code', model: 'claude-opus-5.5', role: 'planner', cwd: '/repo/payments' },
})
push('message.user', {
  dt: 180,
  session: S.planner,
  agent: 'planner',
  data: { text: '把 payments 服务的重试逻辑改成分级退避，并补齐测试。别动公共库。' },
})
push('status', { dt: 60, session: S.planner, agent: 'planner', data: { state: 'thinking' } })
push('think', {
  dt: 900,
  session: S.planner,
  agent: 'planner',
  data: { text: '先定位重试实现 → 看现有测试 → 让 coder 改 → reviewer 复审。两个子任务可以并行起步。' },
})
push('message.agent', {
  dt: 1500,
  session: S.planner,
  agent: 'planner',
  data: { text: '拆成三步：1) 定位重试实现与测试覆盖 2) coder 实现分级退避 3) reviewer 复审 diff。已把实现交给 coder。' },
})
push('usage', {
  dt: 40,
  session: S.planner,
  agent: 'planner',
  data: { in: 4200, out: 610, cached: 1800, costUsd: 0.041 },
})
push('checkpoint', { dt: 20, session: S.planner, agent: 'planner', data: { name: 'plan-ready' } })

// ── 委派：planner → coder ──────────────────────────────────────────────────
push('edge', {
  dt: 260,
  session: S.planner,
  agent: 'planner',
  data: { from: S.planner, to: S.coder, kind: 'delegate', label: '实现分级退避' },
})
push('session.start', {
  dt: 340,
  session: S.coder,
  agent: 'coder',
  data: { runtime: 'codex', model: 'gpt-6-sol', role: 'coder', cwd: '/repo/payments' },
})
// planner 交出去之后并不是"没事干"，而是在等 —— 这正是可视化最该显示的东西
push('status', {
  dt: 80,
  session: S.planner,
  agent: 'planner',
  data: { state: 'waiting', waitingFor: S.coder, reason: '等待实现完成' },
})
push('status', { dt: 40, session: S.coder, agent: 'coder', data: { state: 'thinking' } })
push('tool.call', {
  dt: 780,
  session: S.coder,
  agent: 'coder',
  call: 'call-1',
  data: { tool: 'shell', summary: "rg -n 'retry|backoff' src/", input: { command: "rg -n 'retry|backoff' src/" } },
})
push('tool.result', {
  dt: 420,
  session: S.coder,
  agent: 'coder',
  call: 'call-1',
  data: { ok: true, ms: 410, output: 'src/http/retry.ts:12:  const MAX_RETRIES = 3\nsrc/http/retry.ts:31:  await sleep(1000)' },
})
push('tool.call', {
  dt: 900,
  session: S.coder,
  agent: 'coder',
  call: 'call-2',
  data: { tool: 'read_file', summary: 'src/http/retry.ts', input: { path: 'src/http/retry.ts' } },
})
push('tool.result', {
  dt: 260,
  session: S.coder,
  agent: 'coder',
  call: 'call-2',
  data: { ok: true, ms: 240, output: '…(文件 48 行，固定 3 次 × 1s 重试)…' },
})
push('message.agent', {
  dt: 700,
  session: S.coder,
  agent: 'coder',
  data: { text: '现状：固定 3 次、每次等 1s，没有退避也没有上限。改成 1s/2s/4s… 带上限 30s。' },
})

// ── planner → reviewer：先建会话，但被 coder 挡住 ──────────────────────────
push('edge', {
  dt: 200,
  session: S.planner,
  agent: 'planner',
  data: { from: S.planner, to: S.reviewer, kind: 'ask', label: '接手复审' },
})
push('session.start', {
  dt: 260,
  session: S.reviewer,
  agent: 'reviewer',
  data: { runtime: 'claude-code', model: 'claude-sonnet-5.5', role: 'reviewer', cwd: '/repo/payments' },
})
push('status', {
  dt: 210,
  session: S.reviewer,
  agent: 'reviewer',
  data: { state: 'blocked', waitingFor: S.coder, reason: '等待 coder 提交 diff' },
})

// ── coder 改实现 ───────────────────────────────────────────────────────────
push('status', { dt: 1600, session: S.coder, agent: 'coder', data: { state: 'thinking' } })
push('tool.call', {
  dt: 2400,
  session: S.coder,
  agent: 'coder',
  call: 'call-3',
  data: { tool: 'edit_file', summary: 'src/http/retry.ts', input: { path: 'src/http/retry.ts' } },
})
push('file.edit', {
  dt: 340,
  session: S.coder,
  agent: 'coder',
  data: { path: 'src/http/retry.ts', added: 42, removed: 18 },
})
push('tool.result', {
  dt: 120,
  session: S.coder,
  agent: 'coder',
  call: 'call-3',
  data: { ok: true, ms: 300, output: '+ 分级退避实现' },
})
push('tool.call', {
  dt: 420,
  session: S.coder,
  agent: 'coder',
  call: 'call-4',
  data: { tool: 'shell', summary: 'npm test -- retry', input: { command: 'npm test -- retry' } },
})

// ── 第一次测试失败 ─────────────────────────────────────────────────────────
push('tool.result', {
  dt: 3600,
  session: S.coder,
  agent: 'coder',
  call: 'call-4',
  data: {
    ok: false,
    ms: 3520,
    error: 'exit 1 · 2 failed',
    output: 'FAIL test/retry.spec.ts\n  ✕ retries exactly 3 times\n  ✕ waits 1s between attempts',
  },
})
push('error', {
  dt: 80,
  session: S.coder,
  agent: 'coder',
  data: { message: '测试失败：断言把重试次数写死为 3', fatal: false },
})
push('usage', {
  dt: 40,
  session: S.coder,
  agent: 'coder',
  data: { in: 8600, out: 1180, cached: 5200, costUsd: 0.031 },
})
push('message.agent', {
  dt: 480,
  session: S.coder,
  agent: 'coder',
  data: { text: '测试挂了 2 个 —— 断言把次数和间隔写死了。需要一并更新测试。' },
})
push('tool.call', {
  dt: 640,
  session: S.coder,
  agent: 'coder',
  call: 'call-5',
  data: { tool: 'edit_file', summary: 'test/retry.spec.ts', input: { path: 'test/retry.spec.ts' } },
})
push('file.edit', {
  dt: 300,
  session: S.coder,
  agent: 'coder',
  data: { path: 'test/retry.spec.ts', added: 6, removed: 3 },
})
push('tool.result', { dt: 90, session: S.coder, agent: 'coder', call: 'call-5', data: { ok: true, ms: 280 } })
push('tool.call', {
  dt: 320,
  session: S.coder,
  agent: 'coder',
  call: 'call-6',
  data: { tool: 'shell', summary: 'npm test -- retry', input: { command: 'npm test -- retry' } },
})
push('tool.result', {
  dt: 2800,
  session: S.coder,
  agent: 'coder',
  call: 'call-6',
  data: { ok: true, ms: 2760, output: 'PASS test/retry.spec.ts (7 tests)' },
})
// ── 批量改造：把同一模式推广到其它 8 个文件 ────────────────────────────────
// 这一段的存在是为了让瀑布图/时间轴有真实密度：真实任务的工具调用是几十上百次，
// 只有 3 条工具调用的 demo 看不出"哪里慢"。
const bulk = [
  'src/http/client.ts',
  'src/http/pool.ts',
  'src/http/session.ts',
  'src/http/proxy.ts',
  'src/http/circuit.ts',
  'src/http/timeout.ts',
  'src/http/telemetry.ts',
  'src/http/router.ts',
]
bulk.forEach((path, i) => {
  push('tool.call', {
    dt: 130,
    session: S.coder,
    agent: 'coder',
    call: `call-b${i}a`,
    data: { tool: 'read_file', summary: path, input: { path } },
  })
  push('tool.result', {
    dt: 170,
    session: S.coder,
    agent: 'coder',
    call: `call-b${i}a`,
    data: { ok: true, ms: 150, output: `…${path}（待改造）…` },
  })
  push('tool.call', {
    dt: 110,
    session: S.coder,
    agent: 'coder',
    call: `call-b${i}b`,
    data: { tool: 'edit_file', summary: path, input: { path } },
  })
  // 第 4 个文件改失败一次：瀑布图里要有一条红色失败条，归因才有说服力
  if (i === 3) {
    push('tool.result', {
      dt: 90,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}b`,
      data: { ok: false, ms: 80, error: 'FS_STALE_VERSION：文件被别的进程改了' },
    })
    push('error', {
      dt: 40,
      session: S.coder,
      agent: 'coder',
      data: { message: '写入冲突，重读后重试', fatal: false },
    })
    push('tool.call', {
      dt: 120,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}c`,
      data: { tool: 'read_file', summary: path, input: { path } },
    })
    push('tool.result', {
      dt: 140,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}c`,
      data: { ok: true, ms: 130 },
    })
    push('tool.call', {
      dt: 100,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}d`,
      data: { tool: 'edit_file', summary: path, input: { path } },
    })
    push('tool.result', {
      dt: 80,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}d`,
      data: { ok: true, ms: 70 },
    })
  } else {
    push('tool.result', {
      dt: 80,
      session: S.coder,
      agent: 'coder',
      call: `call-b${i}b`,
      data: { ok: true, ms: 70 },
    })
  }
  push('file.edit', {
    dt: 60,
    session: S.coder,
    agent: 'coder',
    data: { path, added: 4 + (i % 3), removed: 1 },
  })
})

push('tool.call', {
  dt: 140,
  session: S.coder,
  agent: 'coder',
  call: 'call-bt',
  data: { tool: 'shell', summary: 'npm test', input: { command: 'npm test' } },
})
push('tool.result', {
  dt: 2600,
  session: S.coder,
  agent: 'coder',
  call: 'call-bt',
  data: { ok: true, ms: 2550, output: 'PASS (23 tests)' },
})
push('usage', {
  dt: 50,
  session: S.coder,
  agent: 'coder',
  data: { in: 24500, out: 3100, cached: 18200, costUsd: 0.083 },
})
push('think', {
  dt: 160,
  session: S.coder,
  agent: 'coder',
  data: { text: '9 个文件都改完了，测试全绿，可以交复审了。' },
})

push('message.agent', {
  dt: 420,
  session: S.coder,
  agent: 'coder',
  data: { text: '改完了，23 个测试全绿。diff 已就绪，交复审。' },
})
push('edge', {
  dt: 260,
  session: S.coder,
  agent: 'coder',
  data: { from: S.coder, to: S.reviewer, kind: 'handoff', label: '提交复审' },
})

// ── reviewer 解除阻塞，开始复审 ────────────────────────────────────────────
push('status', { dt: 320, session: S.reviewer, agent: 'reviewer', data: { state: 'thinking' } })
push('status', { dt: 120, session: S.coder, agent: 'coder', data: { state: 'idle' } })
push('tool.call', {
  dt: 640,
  session: S.reviewer,
  agent: 'reviewer',
  call: 'call-7',
  data: { tool: 'shell', summary: 'git diff --stat', input: { command: 'git diff --stat' } },
})
push('tool.result', {
  dt: 380,
  session: S.reviewer,
  agent: 'reviewer',
  call: 'call-7',
  data: { ok: true, ms: 360, output: ' src/http/retry.ts | 60 +++++++++---\n test/retry.spec.ts | 9 +++--' },
})
push('tool.call', {
  dt: 520,
  session: S.reviewer,
  agent: 'reviewer',
  call: 'call-8',
  data: { tool: 'read_file', summary: 'src/http/retry.ts', input: { path: 'src/http/retry.ts' } },
})
push('tool.result', {
  dt: 300,
  session: S.reviewer,
  agent: 'reviewer',
  call: 'call-8',
  data: { ok: true, ms: 280, output: '…(60 行 diff)…' },
})
push('message.agent', {
  dt: 900,
  session: S.reviewer,
  agent: 'reviewer',
  data: { text: '实现是对的，但有一个问题：退避没有硬上限，指数增长在高负载时会打到 30s 以上，反而放大雪崩。' },
})
push('edge', {
  dt: 220,
  session: S.reviewer,
  agent: 'reviewer',
  data: { from: S.reviewer, to: S.coder, kind: 'reply', label: '要求加 cap' },
})

// ── 返工 ───────────────────────────────────────────────────────────────────
push('status', { dt: 420, session: S.coder, agent: 'coder', data: { state: 'thinking' } })
push('tool.call', {
  dt: 700,
  session: S.coder,
  agent: 'coder',
  call: 'call-9',
  data: { tool: 'edit_file', summary: 'src/http/retry.ts', input: { path: 'src/http/retry.ts' } },
})
push('file.edit', {
  dt: 280,
  session: S.coder,
  agent: 'coder',
  data: { path: 'src/http/retry.ts', added: 4, removed: 1 },
})
push('tool.result', { dt: 100, session: S.coder, agent: 'coder', call: 'call-9', data: { ok: true, ms: 260 } })
push('tool.call', {
  dt: 260,
  session: S.coder,
  agent: 'coder',
  call: 'call-10',
  data: { tool: 'shell', summary: 'npm test -- retry', input: { command: 'npm test -- retry' } },
})
push('tool.result', {
  dt: 2200,
  session: S.coder,
  agent: 'coder',
  call: 'call-10',
  data: { ok: true, ms: 2140, output: 'PASS test/retry.spec.ts (8 tests)' },
})
push('edge', {
  dt: 180,
  session: S.coder,
  agent: 'coder',
  data: { from: S.coder, to: S.reviewer, kind: 'handoff', label: '已加 cap，请复审' },
})
push('message.agent', {
  dt: 640,
  session: S.reviewer,
  agent: 'reviewer',
  data: { text: '复审通过 ✓ 加了 30s 硬上限，测试补了 cap 用例。' },
})
push('usage', {
  dt: 60,
  session: S.coder,
  agent: 'coder',
  data: { in: 9800, out: 1420, cached: 7100, costUsd: 0.034 },
})
push('usage', {
  dt: 120,
  session: S.reviewer,
  agent: 'reviewer',
  data: { in: 11800, out: 1420, cached: 9600, costUsd: 0.052 },
})
push('session.end', { dt: 160, session: S.reviewer, agent: 'reviewer', data: { status: 'done' } })

// ── 收尾 ───────────────────────────────────────────────────────────────────
push('status', { dt: 60, session: S.planner, agent: 'planner', data: { state: 'thinking' } })
push('session.end', { dt: 360, session: S.coder, agent: 'coder', data: { status: 'done' } })
push('usage', {
  dt: 260,
  session: S.planner,
  agent: 'planner',
  data: { in: 4600, out: 380, cached: 4200, costUsd: 0.028 },
})
push('message.agent', {
  dt: 720,
  session: S.planner,
  agent: 'planner',
  data: { text: '完成：分级退避（1s→2s→4s，上限 30s）+ 测试 7→8 个，改动 2 个文件 +46 -19。' },
})
push('session.end', { dt: 180, session: S.planner, agent: 'planner', data: { status: 'done' } })
push('run.end', { dt: 240, data: { status: 'done', wall: '2026-10-21T09:15:41.000Z' } })

const out = new URL('../fixtures/mission-demo.ndjson', import.meta.url)
writeNdjson(new URL(out).pathname, events)

const duration = events[events.length - 1]?.t ?? 0
const sessions = new Set(events.map((e) => e.session).filter(Boolean)).size
process.stdout.write(
  `✓ fixtures/mission-demo.ndjson  ${events.length} 事件 · ${(duration / 1000).toFixed(1)}s · ${sessions} sessions\n`,
)
