/**
 * 解码结果磁盘缓存测试。
 *
 * 缓存最大的风险不是"慢"，而是"给了过期的数据"。所以这里的重点是
 * key 失效、坏缓存回退、活会话不写。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CACHE_DIR = mkdtempSync(join(tmpdir(), 'bb-evcache-'))
process.env['BLACKBOX_EVENT_CACHE'] = CACHE_DIR

import { cacheStats, clearCache, readEvents, writeEvents } from '../src/event-cache.ts'
import type { Event } from '../src/schema.ts'
import type { SourceSession } from '../src/sources.ts'

const TAIL = 8 * 1024 * 1024

function makeSession(overrides: Partial<SourceSession> = {}): SourceSession {
  const dir = mkdtempSync(join(tmpdir(), 'bb-sess-'))
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, 'x')
  // 改成 5 分钟前，满足"安静文件"条件
  const old = (Date.now() - 300_000) / 1000
  utimesSync(file, old, old)
  return {
    runtime: 'dsh',
    adapter: 'dsh',
    sessionId: 'session-test',
    project: 'demo',
    file,
    format: 'zstd-jsonl',
    size: 1234,
    mtime: old * 1000,
    ...overrides,
  }
}

function makeEvents(n: number): Event[] {
  return Array.from({ length: n }, (_, i) => ({
    v: 2,
    seq: i,
    t: i * 10,
    run: 'r',
    session: 's',
    agent: 'a',
    kind: 'checkpoint' as const,
    data: { name: `c${i}` },
  }))
}

test('缓存读写往返：内容一致', () => {
  clearCache()
  const session = makeSession()
  const events = makeEvents(50)
  assert.equal(writeEvents(session, { full: false, tailBytes: TAIL }, events), true)
  const hit = readEvents(session, { full: false, tailBytes: TAIL })
  assert.ok(hit)
  assert.equal(hit!.events.length, 50)
  assert.deepEqual(hit!.events, events)
  assert.equal(cacheStats().entries, 1)
})

test('key 失效：size / mtime / 适配器 / 窗口任一变化都 miss', () => {
  clearCache()
  const session = makeSession()
  const events = makeEvents(5)
  writeEvents(session, { full: false, tailBytes: TAIL }, events)

  assert.equal(readEvents({ ...session, size: session.size + 1 }, { full: false, tailBytes: TAIL }), undefined)
  assert.equal(
    readEvents({ ...session, mtime: session.mtime + 1000 }, { full: false, tailBytes: TAIL }),
    undefined,
  )
  assert.equal(
    readEvents({ ...session, adapter: 'codex-session' }, { full: false, tailBytes: TAIL }),
    undefined,
  )
  assert.equal(readEvents(session, { full: true, tailBytes: TAIL }), undefined)
})

test('活会话不写缓存（30 秒内仍在变化）', () => {
  clearCache()
  const session = makeSession({ mtime: Date.now() - 5_000 })
  assert.equal(writeEvents(session, { full: false, tailBytes: TAIL }, makeEvents(5)), false)
  assert.equal(readEvents(session, { full: false, tailBytes: TAIL }), undefined)
})

test('坏缓存不抛错：当作 miss 并删除', () => {
  clearCache()
  const session = makeSession()
  writeEvents(session, { full: false, tailBytes: TAIL }, makeEvents(3))
  const files = readdirSync(CACHE_DIR)
  assert.equal(files.length, 1)
  writeFileSync(join(CACHE_DIR, files[0]!), 'not gzip at all')
  assert.equal(readEvents(session, { full: false, tailBytes: TAIL }), undefined)
  assert.equal(cacheStats().entries, 0, '坏缓存应被删除')
})

test('clearCache 清空所有条目', () => {
  clearCache()
  const a = makeSession()
  const b = makeSession()
  writeEvents(a, { full: false, tailBytes: TAIL }, makeEvents(3))
  writeEvents(b, { full: false, tailBytes: TAIL }, makeEvents(3))
  assert.equal(cacheStats().entries, 2)
  assert.equal(clearCache(), 2)
  assert.equal(cacheStats().entries, 0)
})
