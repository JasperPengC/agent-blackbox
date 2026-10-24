/**
 * DSH 会话标题读取测试。
 * 标题缺失时不能让整个列表失败（坏文件跳过），两种历史文件名都要认。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'bb-titles-'))
process.env['DSH_TITLES_DIR'] = DIR

import { displayTitle, dshTitleOf, sessionIdFromFile } from '../src/dsh-titles.ts'

function write(name: string, payload: unknown): void {
  writeFileSync(join(DIR, name), JSON.stringify(payload))
}

const rowsOf = (title: unknown, first?: string) => ({
  record: {
    rows: {
      title: { val: title },
      titleInput: { val: { first: first === undefined ? null : { text: first } } },
    },
  },
})

test('读取 LLM 标题（session- 前缀与裸 uuid 两种文件名）', () => {
  write('aaaaaaaa-1111-2222-3333-444444444444.json', rowsOf('智能体黑匣子'))
  write('session-bbbbbbbb-1111-2222-3333-444444444444.json', rowsOf('产品开发'))
  assert.equal(dshTitleOf('session-aaaaaaaa-1111-2222-3333-444444444444')?.title, '智能体黑匣子')
  assert.equal(dshTitleOf('session-bbbbbbbb-1111-2222-3333-444444444444')?.title, '产品开发')
})

test('标题为空时 displayTitle 返回 undefined（不拿首条消息冒充标题）', () => {
  write('cccccccc-1111-2222-3333-444444444444.json', rowsOf(null, '我想要开发一个智能体'))
  const hit = dshTitleOf('session-cccccccc-1111-2222-3333-444444444444')
  assert.equal(hit?.title, undefined)
  assert.equal(hit?.firstMessage, '我想要开发一个智能体')
  assert.equal(displayTitle('session-cccccccc-1111-2222-3333-444444444444'), undefined)
})

test('坏文件 / 缺字段不影响其它会话', () => {
  writeFileSync(join(DIR, 'dddddddd-1111-2222-3333-444444444444.json'), '{ not json')
  write('eeeeeeee-1111-2222-3333-444444444444.json', { record: { rows: {} } })
  assert.equal(dshTitleOf('session-dddddddd-1111-2222-3333-444444444444'), undefined)
  assert.equal(dshTitleOf('session-eeeeeeee-1111-2222-3333-444444444444'), undefined)
  assert.equal(displayTitle('session-aaaaaaaa-1111-2222-3333-444444444444'), '智能体黑匣子')
})

test('displayTitle 截断过长标题', () => {
  const long = '很长的标题'.repeat(40)
  write('ffffffff-1111-2222-3333-444444444444.json', rowsOf(long))
  const t = displayTitle('session-ffffffff-1111-2222-3333-444444444444')
  assert.ok(t && t.length <= 81)
  assert.ok(t!.endsWith('…'))
})

test('sessionIdFromFile 从路径解析', () => {
  assert.equal(
    sessionIdFromFile('/x/sessions/p/session-12345678-1234-1234-1234-123456789abc/session.v4.jsonl.zstd'),
    'session-12345678-1234-1234-1234-123456789abc',
  )
  assert.equal(sessionIdFromFile('/x/fixtures/mission-demo.ndjson'), undefined)
})
