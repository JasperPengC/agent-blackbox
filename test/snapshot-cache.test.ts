/**
 * 首屏快照缓存测试。
 * 快照是"用空间换首屏时间"，所以出错的方式也主要是两种：
 *   1. 给了过期的快照（key 失效没生效）；
 *   2. 坏文件让服务端抛错（必须当 miss 并删除）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SNAP_DIR = mkdtempSync(join(tmpdir(), 'bb-snap-'))
process.env['BLACKBOX_SNAPSHOT_CACHE'] = SNAP_DIR

import { DEFAULT_SNAPSHOT_QUERY, clearSnapshots, readSnapshot, snapshotStats, writeSnapshot, type Snapshot } from '../src/snapshot-cache.ts'
import type { SourceSession } from '../src/sources.ts'

const TAIL = 8 * 1024 * 1024

function makeSession(overrides: Partial<SourceSession> = {}): SourceSession {
  const dir = mkdtempSync(join(tmpdir(), 'bb-snap-sess-'))
  const file = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(file, 'x')
  const old = (Date.now() - 300_000) / 1000
  utimesSync(file, old, old)
  return {
    runtime: 'dsh',
    adapter: 'dsh',
    sessionId: 'session-snap',
    project: 'demo',
    file,
    format: 'zstd-jsonl',
    size: 999,
    mtime: old * 1000,
    ...overrides,
  }
}

function makeSnapshot(duration: number): Snapshot {
  return {
    v: 1,
    duration,
    query: DEFAULT_SNAPSHOT_QUERY,
    meta: { eventCount: 42, duration, agentCount: 1 },
    series: { buckets: [{ t: 0, in: 10, out: 5, cached: 2 }] },
    spans: { from: 0, to: duration, count: 0, spans: [] },
    state: { state: { t: duration, agents: {} }, attribution: {} },
    events: { from: 0, to: duration, count: 0, events: [] },
  }
}

test('快照读写往返：内容一致', () => {
  clearSnapshots()
  const session = makeSession()
  assert.equal(writeSnapshot(session, { full: false, tailBytes: TAIL }, makeSnapshot(1234)), true)
  const back = readSnapshot(session, { full: false, tailBytes: TAIL })
  assert.ok(back)
  assert.equal(back!.duration, 1234)
  assert.equal((back!.meta as { eventCount: number }).eventCount, 42)
  assert.equal(snapshotStats().entries, 1)
})

test('key 失效：文件变化后不再返回旧快照', () => {
  clearSnapshots()
  const session = makeSession()
  writeSnapshot(session, { full: false, tailBytes: TAIL }, makeSnapshot(100))
  assert.equal(
    readSnapshot({ ...session, mtime: session.mtime + 5000 }, { full: false, tailBytes: TAIL }),
    undefined,
  )
  assert.equal(readSnapshot({ ...session, size: session.size + 1 }, { full: false, tailBytes: TAIL }), undefined)
  assert.equal(readSnapshot(session, { full: true, tailBytes: TAIL }), undefined)
})

test('活会话不写快照', () => {
  clearSnapshots()
  const session = makeSession({ mtime: Date.now() - 1000 })
  assert.equal(writeSnapshot(session, { full: false, tailBytes: TAIL }, makeSnapshot(100)), false)
  assert.equal(snapshotStats().entries, 0)
})

test('坏快照当作 miss 并删除', () => {
  clearSnapshots()
  const session = makeSession()
  writeSnapshot(session, { full: false, tailBytes: TAIL }, makeSnapshot(100))
  const files = readdirSync(SNAP_DIR)
  assert.equal(files.length, 1)
  writeFileSync(join(SNAP_DIR, files[0]!), 'garbage')
  assert.equal(readSnapshot(session, { full: false, tailBytes: TAIL }), undefined)
  assert.equal(snapshotStats().entries, 0)
})

test('结构不完整（缺 state/events）也当 miss', () => {
  clearSnapshots()
  const session = makeSession()
  const broken = { ...makeSnapshot(1), events: undefined } as unknown as Snapshot
  writeSnapshot(session, { full: false, tailBytes: TAIL }, broken)
  assert.equal(readSnapshot(session, { full: false, tailBytes: TAIL }), undefined)
})

test('clearSnapshots 清空', () => {
  clearSnapshots()
  const a = makeSession()
  const b = makeSession()
  writeSnapshot(a, { full: false, tailBytes: TAIL }, makeSnapshot(1))
  writeSnapshot(b, { full: false, tailBytes: TAIL }, makeSnapshot(2))
  assert.equal(snapshotStats().entries, 2)
  assert.equal(clearSnapshots(), 2)
  assert.equal(snapshotStats().entries, 0)
})
