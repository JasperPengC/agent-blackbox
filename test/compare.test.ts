/**
 * 跨会话对比测试。
 *
 * 对比页最容易错的地方不是渲染，而是**口径**：
 *   · Δ 的方向（右 − 左）与百分比的分母；
 *   · 缓存命中复用后结果必须一致；
 *   · 某一边没有该工具时，不能把"0 次"算成缺失。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES = fileURLToPath(new URL('../fixtures/multi-runtime/', import.meta.url))
process.env['DSH_SESSIONS_DIR'] = `${FIXTURES}dsh`
process.env['CLAUDE_PROJECTS_DIR'] = `${FIXTURES}claude`
process.env['CODEX_SESSIONS_DIR'] = `${FIXTURES}codex`
process.env['BLACKBOX_CACHE'] = join(mkdtempSync(join(tmpdir(), 'bb-cmp-')), 'cache.json')

import { computeCompare } from '../src/compare.ts'
import { discoverAll } from '../src/sources.ts'

function fileOf(sessionIdPart: string): string {
  const hit = discoverAll().find((s) => s.sessionId.includes(sessionIdPart))
  assert.ok(hit, `找不到会话 ${sessionIdPart}`)
  return hit!.file
}

test('computeCompare: Δ 方向与百分比口径正确', () => {
  const left = fileOf('2d10be77') // 小会话（12 次工具）
  const right = fileOf('8f2c41aa') // 大会话（34 次工具）
  const r = computeCompare({ left, right })

  const toolDelta = r.deltas.toolCalls!
  assert.equal(toolDelta.left, r.left.toolCalls)
  assert.equal(toolDelta.right, r.right.toolCalls)
  assert.equal(toolDelta.abs, r.right.toolCalls - r.left.toolCalls)
  assert.ok(Math.abs(toolDelta.pct! - (toolDelta.abs / r.left.toolCalls) * 100) < 1e-9)

  // 反向对比：Δ 应该变号，绝对值相同
  const rev = computeCompare({ left: right, right: left })
  assert.equal(rev.deltas.toolCalls!.abs, -toolDelta.abs)
})

test('computeCompare: 工具分布是并集，按两侧总次数排序', () => {
  const r = computeCompare({ left: fileOf('8f2c41aa'), right: fileOf('b31c9d54') })
  assert.ok(r.tools.length > 0)
  const totals = r.tools.map((t) => t.left.calls + t.right.calls)
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i - 1]! >= totals[i]!, '工具应按总调用次数倒序')
  }
  // 某一侧没有的工具体现为 0 次，而不是 undefined
  for (const t of r.tools) {
    assert.equal(typeof t.left.calls, 'number')
    assert.equal(typeof t.right.calls, 'number')
  }
})

test('computeCompare: 同一模型会被识别为共有，成本可算', () => {
  const r = computeCompare({ left: fileOf('8f2c41aa'), right: fileOf('2d10be77') })
  assert.deepEqual(r.models.shared, ['deepseek-v4.1-flash'])
  assert.ok(r.left.cost !== undefined && r.left.cost > 0, 'DeepSeek 内置价应能算成本')
  assert.equal(r.left.missingPrice, false)
  assert.equal(r.currency, 'USD')
})

test('computeCompare: 未定价模型标记为 missing，且不参与成本合计', () => {
  const r = computeCompare({ left: fileOf('01a15aaa'), right: fileOf('8f2c41aa') })
  assert.equal(r.left.missingPrice, true)
  assert.equal(r.left.cost, undefined)
  assert.ok(r.unpricedModels.includes('gpt-5-codex'))
})

test('computeCompare: 第二次调用命中缓存，结果完全一致', () => {
  const left = fileOf('8f2c41aa')
  const right = fileOf('b31c9d54')
  const first = computeCompare({ left, right })
  const second = computeCompare({ left, right })
  assert.deepEqual(second, first)
})

test('computeCompare: 会话不存在时报清晰错误', () => {
  assert.throws(() => computeCompare({ left: '/nope/a.zstd', right: fileOf('8f2c41aa') }), /找不到会话/)
})
