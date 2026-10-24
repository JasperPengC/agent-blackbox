/**
 * 时间窗数学的测试。
 * 这些边界条件只有真去拖时间轴才会遇到：锚点漂移、缩到 0、越界回弹。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_WINDOW_MS,
  brushWindow,
  clampWindow,
  intersects,
  isFullWindow,
  panWindow,
  tOf,
  xOf,
  zoomWindow,
} from '../web/timeline-math.js'

const DUR = 60_000

test('clampWindow: 越界被夹回，反向区间自动排序', () => {
  assert.deepEqual(clampWindow(-500, 5000, DUR), { from: 0, to: 5000 })
  assert.deepEqual(clampWindow(58_000, 70_000, DUR), { from: 58_000, to: DUR })
  assert.deepEqual(clampWindow(9000, 4000, DUR), { from: 4000, to: 9000 })
})

test('clampWindow: 太窄的窗口会撑到最小宽度，且不越界', () => {
  const nearZero = clampWindow(0, 1, DUR)
  assert.ok(nearZero.to - nearZero.from >= MIN_WINDOW_MS)
  assert.equal(nearZero.from, 0)
  const nearEnd = clampWindow(DUR - 1, DUR, DUR)
  assert.ok(nearEnd.to - nearEnd.from >= MIN_WINDOW_MS)
  assert.equal(nearEnd.to, DUR)
})

test('zoomWindow: 锚点在屏幕上的相对位置保持不变（滚轮对着哪就放大哪）', () => {
  const view = { from: 0, to: 60_000 }
  const anchor = 15_000 // 相对位置 0.25
  const zoomed = zoomWindow(view, DUR, anchor, 0.5)
  assert.ok(Math.abs((anchor - zoomed.from) / (zoomed.to - zoomed.from) - 0.25) < 1e-6)
  assert.ok(Math.abs(zoomed.to - zoomed.from - 30_000) < 1e-6)
})

test('zoomWindow: 不会缩到 0，也不会超出总时长', () => {
  let view = { from: 0, to: DUR }
  for (let i = 0; i < 40; i++) view = zoomWindow(view, DUR, 30_000, 0.6)
  assert.ok(view.to - view.from >= MIN_WINDOW_MS - 1e-6, `窗口过窄：${view.to - view.from}`)
  for (let i = 0; i < 40; i++) view = zoomWindow(view, DUR, 30_000, 4)
  assert.deepEqual(view, { from: 0, to: DUR })
})

test('zoomWindow: 靠近边界时仍不越界', () => {
  const view = { from: 0, to: 10_000 }
  const zoomed = zoomWindow(view, DUR, 500, 0.2) // 想在左边界外放大
  assert.ok(zoomed.from >= 0 && zoomed.to <= DUR)
  const right = zoomWindow({ from: 55_000, to: 60_000 }, DUR, 59_500, 0.2)
  assert.ok(right.from >= 0 && right.to <= DUR)
})

test('panWindow: 平移不越界，窗口宽度不变', () => {
  const view = { from: 10_000, to: 20_000 }
  const moved = panWindow(view, DUR, 5_000)
  assert.deepEqual(moved, { from: 15_000, to: 25_000 })
  const left = panWindow(view, DUR, -50_000)
  assert.equal(left.from, 0)
  assert.equal(left.to, 10_000)
  const right = panWindow(view, DUR, 50_000)
  assert.equal(right.to, DUR)
})

test('brushWindow: 反向框选也能得到正确区间，极窄框选被撑开', () => {
  assert.deepEqual(brushWindow(30_000, 10_000, DUR), { from: 10_000, to: 30_000 })
  const tiny = brushWindow(10_000, 10_001, DUR)
  assert.ok(tiny.to - tiny.from >= MIN_WINDOW_MS)
})

test('isFullWindow: 全量判定有容差', () => {
  assert.equal(isFullWindow({ from: 0, to: DUR }, DUR), true)
  assert.equal(isFullWindow({ from: 0.4, to: DUR - 0.3 }, DUR), true)
  assert.equal(isFullWindow({ from: 100, to: DUR }, DUR), false)
})

test('xOf / tOf 互逆', () => {
  const view = { from: 12_345, to: 54_321 }
  for (const W of [320, 800, 1600]) {
    for (const x of [1, 40, W / 3, W / 2, W - 1]) {
      assert.ok(Math.abs(xOf(tOf(x, view, W), view, W) - x) < 1e-6, `W=${W} x=${x}`)
    }
  }
})

test('intersects: 进行中的调用（end=null）算相交', () => {
  const view = { from: 10_000, to: 20_000 }
  assert.equal(intersects(12_000, 13_000, view), true)
  assert.equal(intersects(5_000, 9_000, view), false)
  assert.equal(intersects(5_000, null, view), true)
  assert.equal(intersects(21_000, null, view), false)
})
