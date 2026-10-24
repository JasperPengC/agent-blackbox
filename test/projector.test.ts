/**
 * 投影器测试 —— 这个项目的正确性核心。
 *
 * 最重要的一条断言：**seek(t) 必须等价于"从头 fold 到 t"**。
 * 一旦它不成立，回放就是在撒谎，整个项目的价值归零。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseNdjson } from '../src/ndjson.ts'
import {
  attribution,
  buildIndex,
  fold,
  initialState,
  refreshBlocked,
  reduce,
  seek,
  type Index,
  type RunState,
} from '../src/projector.ts'
import type { Event } from '../src/schema.ts'

const FIXTURE = fileURLToPath(new URL('../fixtures/mission-demo.ndjson', import.meta.url))

function loadFixture(): { events: Event[]; ix: Index } {
  const events = parseNdjson(readFileSync(FIXTURE, 'utf8')).events
  return { events, ix: buildIndex(events) }
}

/** 去掉"目标时刻"这类会随查询变化的字段，只比较语义状态。 */
function semantic(s: RunState): unknown {
  return JSON.parse(
    JSON.stringify({
      seq: s.seq,
      run: s.run,
      agents: s.agents,
      order: s.order,
      edges: s.edges,
      stats: s.stats,
      files: s.files,
    }),
  )
}

test('fixture 能被完整解析，且事件流按 seq 单调', () => {
  const { events } = loadFixture()
  assert.ok(events.length > 50, `事件太少：${events.length}`)
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i]!.seq > events[i - 1]!.seq, `seq 不单调：${i}`)
    assert.ok(events[i]!.t >= events[i - 1]!.t, `t 不单调：${i}`)
  }
})

test('seek(t) 等价于从头 fold 到 t（20 个采样点）', () => {
  const { events, ix } = loadFixture()
  for (let k = 0; k <= 20; k++) {
    const t = Math.round((ix.duration * k) / 20)
    const projected = seek(ix, t)
    // 参照系：从头 fold 到 t，并把时刻对齐到 t（阻塞时长的计算基准是"当前时刻"）
    const reference = fold(events.filter((e) => e.t <= t))
    reference.t = projected.t
    refreshBlocked(reference)
    assert.deepEqual(semantic(projected), semantic(reference), `t=${t} 处投影不一致`)
  }
})

test('seek 越界被夹住，不会崩也不会返回未来状态', () => {
  const { ix } = loadFixture()
  assert.equal(seek(ix, -5000).t, 0)
  assert.equal(seek(ix, ix.duration * 10).t, ix.duration)
})

test('检查点确实存在，且 seek 的结果与"无检查点"一致', () => {
  const { events, ix } = loadFixture()
  assert.ok(ix.checkpoints.length >= 1, '没有生成检查点')
  const noCp: Index = { ...ix, checkpoints: [] }
  for (const t of [3000, 12000, 20000, 31000]) {
    assert.deepEqual(semantic(seek(ix, t)), semantic(seek(noCp, t)), `t=${t} 与无检查点结果不一致`)
  }
})

test('归因：能算出谁被谁挡住了多久', () => {
  const { ix } = loadFixture()
  const final = seek(ix, ix.duration)
  const att = attribution(final, ix.duration)
  const planner = att.rows.find((r) => r.agent === 'planner')
  const reviewer = att.rows.find((r) => r.agent === 'reviewer')
  assert.ok(planner, '没有 planner 的归因')
  assert.ok(reviewer, '没有 reviewer 的归因')
  assert.equal(planner!.blockedMs, 34100)
  assert.equal(reviewer!.blockedMs, 22070)
  // 历史归因：解除阻塞后仍然记得"刚才在等谁"
  assert.equal(reviewer!.blockedByName, 'coder')
  assert.equal(reviewer!.reason, '等待 coder 提交 diff')
})

test('reducer：工具调用/失败/文件/用量累计正确', () => {
  const { ix } = loadFixture()
  const final = seek(ix, ix.duration)
  assert.equal(final.stats.toolCalls, 29)
  assert.equal(final.stats.toolFails, 2)
  assert.equal(final.stats.files, 10)
  assert.equal(final.stats.tokens.in, 63500)
  assert.equal(final.run.status, 'done')
  // 工具聚合：shell 5 次、1 次失败、总耗时 9.2s 量级
  const shell = ix.derived.tools['shell']
  assert.ok(shell, '没有 shell 聚合')
  assert.equal(shell!.calls, 6)
  assert.equal(shell!.fails, 1)
  assert.ok(shell!.ms > 11000 && shell!.ms < 12500, `shell 耗时异常：${shell!.ms}`)
})

test('reducer 对未知字段和错类型是容错的', () => {
  const s = initialState('r')
  const bad: Event = {
    v: 1,
    seq: 0,
    t: 10,
    run: 'r',
    session: 's1',
    agent: 'a',
    kind: 'usage',
    data: { in: 'not-a-number', out: null, costUsd: { nope: 1 } },
  }
  reduce(s, bad)
  assert.equal(s.stats.tokens.in, 0)
  assert.equal(s.stats.costUsd, 0)
})

test('edge 事件按 from→to 去重并累计次数', () => {
  const { ix } = loadFixture()
  const final = seek(ix, ix.duration)
  const handoffs = final.edges.filter((e) => e.to === 'sess-reviewer' && e.from === 'sess-coder')
  assert.equal(handoffs.length, 1, 'coder→reviewer 应当合并成一条边')
  assert.equal(handoffs[0]!.count, 2, 'coder→reviewer 出现了两次交接')
})

test('标题检查点会写入 run.title（最后一次为准）', () => {
  const events = [
    { v: 2, seq: 0, t: 0, run: 'r', session: 'a', agent: 'a', kind: 'run.start', data: { goal: '做点事' } },
    { v: 2, seq: 1, t: 10, run: 'r', session: 'a', agent: 'a', kind: 'checkpoint', data: { name: '标题', note: '兜底标题' } },
    { v: 2, seq: 2, t: 20, run: 'r', session: 'a', agent: 'a', kind: 'checkpoint', data: { name: '标题', note: '智能体黑匣子' } },
  ] as Event[]
  const state = fold(events)
  assert.equal(state.run.title, '智能体黑匣子')
})
