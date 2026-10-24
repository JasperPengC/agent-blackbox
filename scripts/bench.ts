/**
 * 性能压测：合成大规模事件流，量 build / seek。
 *
 * 这是 README 里那些数字的来源 —— **数字必须能一键复现**，
 * 否则面试官问一句"你怎么测的"就露馅了。
 *
 * 用法：
 *   node scripts/bench.ts                 # 默认 10 万事件
 *   node scripts/bench.ts 500000          # 50 万
 */

import { buildIndex, seek, slice } from '../src/projector.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseNdjson } from '../src/ndjson.ts'
import type { Event } from '../src/schema.ts'

const target = Number(process.argv[2] ?? '100000')

const fixturePath = fileURLToPath(new URL('../fixtures/mission-demo.ndjson', import.meta.url))
const base = parseNdjson(readFileSync(fixturePath, 'utf8')).events
if (base.length === 0) throw new Error('fixture 为空')

/** 把 fixture 复制 N 份，session 加后缀、seq 重排、t 平移，模拟长时间运行。 */
const events: Event[] = []
const loops = Math.ceil(target / base.length)
const span = (base[base.length - 1]?.t ?? 0) + 2000
let seq = 0

for (let loop = 0; loop < loops; loop++) {
  for (const e of base) {
    // 关键：session 保持不变 —— 模拟"一个长跑任务"，
    // 而不是"250 个 agent 同时在线"（后者是另一类负载，另测）
    events.push({ ...e, seq: seq++, t: e.t + loop * span })
    if (events.length >= target) break
  }
  if (events.length >= target) break
}

const bytes = Buffer.byteLength(JSON.stringify(events))
const memBefore = process.memoryUsage().heapUsed
const t0 = performance.now()
const ix = buildIndex(events)
const buildMs = performance.now() - t0
const memAfter = process.memoryUsage().heapUsed

const samples = 300
const times: number[] = []
for (let i = 0; i < samples; i++) {
  const t = Math.round((ix.duration * i) / (samples - 1))
  const s = performance.now()
  seek(ix, t)
  times.push(performance.now() - s)
}
times.sort((a, b) => a - b)
const at = (q: number): number => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0

// 对照：不建检查点（每事件都从头 fold）的平均耗时
const noCp = (() => {
  const s = performance.now()
  seek({ ...ix, checkpoints: [] }, Math.floor(ix.duration * 0.9))
  return performance.now() - s
})()

const fmt = (n: number): string => (n < 1 ? `${(n * 1000).toFixed(0)}µs` : `${n.toFixed(2)}ms`)

process.stdout.write(
  [
    '',
    `事件数        ${ix.events.length.toLocaleString()}`,
    `NDJSON 体积   ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    `逻辑时长      ${(ix.duration / 1000 / 60).toFixed(1)} min`,
    `检查点        ${ix.checkpoints.length} 个（每 ${ix.every} 事件）`,
    '',
    `buildIndex    ${fmt(buildMs)}`,
    `堆内存增量    ${((memAfter - memBefore) / 1024 / 1024).toFixed(1)} MB`,
    '',
    `seek 中位     ${fmt(at(0.5))}`,
    `seek p95      ${fmt(at(0.95))}`,
    `seek max      ${fmt(times[times.length - 1] ?? 0)}`,
    `seek 无检查点 ${fmt(noCp)}  ← 对照（从 0 折叠一次）`,
    '',
  ].join('\n'),
)
