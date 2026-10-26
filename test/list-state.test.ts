/**
 * 右侧列表空态文案：三种"空"必须区分（否则加载中会误报"没有匹配内容"）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyStateMessage, listNeedsRebuild } from '../web/list-state.js'

test('事件列表：会话没有事件 vs 窗口内没有 vs 筛选无结果', () => {
  assert.equal(
    emptyStateMessage({ tab: 'events', filtered: false, spansCount: 0, eventsCount: 0, totalEvents: 0 }),
    '这个会话还没有事件',
  )
  assert.equal(
    emptyStateMessage({ tab: 'events', filtered: false, spansCount: 3, eventsCount: 0, totalEvents: 500 }),
    '当前时间窗内没有事件 · 拖动时间轴查看其它区间',
  )
  assert.equal(emptyStateMessage({ tab: 'events', filtered: true, spansCount: 3, eventsCount: 100 }), '没有匹配内容')
})

test('工具列表：同样的三种情况', () => {
  assert.equal(
    emptyStateMessage({ tab: 'tools', filtered: false, spansCount: 0, eventsCount: 10, totalEvents: 0 }),
    '这个会话还没有工具调用',
  )
  assert.equal(
    emptyStateMessage({ tab: 'tools', filtered: false, spansCount: 4, eventsCount: 10, totalEvents: 10 }),
    '当前时间窗内没有工具调用 · 拖动时间轴查看其它区间',
  )
  assert.equal(emptyStateMessage({ tab: 'tools', filtered: true, spansCount: 4, eventsCount: 10 }), '没有匹配的工具调用')
})

test('虚拟列表容器：total 相同但容器丢失时也要重建', () => {
  // 正常情况：total 变化 → 重建
  assert.equal(listNeedsRebuild('35', 110, true), true)
  // 正常情况：total 相同且容器存在 → 不重建
  assert.equal(listNeedsRebuild('110', 110, true), false)
  // 切换会话后 total 恰好相同，但空态把 #rlistInner 换掉了 → 必须重建
  assert.equal(listNeedsRebuild('110', 110, false), true)
  // 首次渲染（没有 dataset.total）
  assert.equal(listNeedsRebuild(undefined, 35, false), true)
})
