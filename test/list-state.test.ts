/**
 * 右侧列表空态文案：三种"空"必须区分（否则加载中会误报"没有匹配内容"）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { emptyStateMessage } from '../web/list-state.js'

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
