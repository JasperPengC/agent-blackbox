/**
 * 录制层测试：黑匣子的"不丢、不乱、不乱序"三条承诺。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Recorder, loadNdjson, parseNdjson, serializeEvent } from '../src/ndjson.ts'

test('Recorder: seq 从 0 开始连续，t 单调不减', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-'))
  const file = join(dir, 'run.ndjson')
  const rec = new Recorder({ file, run: 'r1', session: 's1', agent: 'a1', t0: Date.now() })
  try {
    rec.push({ kind: 'run.start', data: { goal: 'g' } })
    rec.push({ kind: 'status', data: { state: 'thinking' } })
    // 故意给一个倒退的时间戳：录制层必须夹住，保证时间轴可折叠
    rec.push({ kind: 'usage', t: 5, data: { in: 1, out: 1 } })
    rec.push({ kind: 'run.end', data: { status: 'done' } })
  } finally {
    rec.close()
  }

  const parsed = loadNdjson(file)
  assert.equal(parsed.skipped, 0)
  assert.deepEqual(
    parsed.events.map((e) => e.seq),
    [0, 1, 2, 3],
  )
  for (let i = 1; i < parsed.events.length; i++) {
    assert.ok(parsed.events[i]!.t >= parsed.events[i - 1]!.t)
  }
  assert.equal(parsed.events[0]!.run, 'r1')
  assert.equal(parsed.events[0]!.session, 's1')
  rmSync(dir, { recursive: true, force: true })
})

test('Recorder: tStep 模式给出合成但单调的时间轴', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-'))
  const file = join(dir, 'run.ndjson')
  const rec = new Recorder({ file, run: 'r', tStep: 250 })
  try {
    rec.push({ kind: 'run.start' })
    rec.push({ kind: 'status' })
    rec.push({ kind: 'run.end' })
  } finally {
    rec.close()
  }
  const ev = loadNdjson(file).events
  assert.deepEqual(
    ev.map((e) => e.t),
    [0, 250, 500],
  )
  rmSync(dir, { recursive: true, force: true })
})

test('parseNdjson: 坏行被跳过并计入 skipped，好行照常保留', () => {
  const good = (seq: number): string =>
    serializeEvent({
      v: 1,
      seq,
      t: seq * 10,
      run: 'r',
      session: '',
      agent: '',
      kind: 'checkpoint',
      data: {},
    })
  const text = [good(0), 'not json', '{"v":1}', good(2), ''].join('\n')
  const res = parseNdjson(text)
  assert.equal(res.events.length, 2)
  assert.equal(res.skipped, 2)
  assert.equal(res.issues.length, 2)
})

test('parseNdjson: lenient 模式把结构不合法的行降级为 raw 而不是丢弃', () => {
  const text = ['{"v":1,"seq":0,"t":0,"run":"r","session":"","agent":"","kind":"who-knows","data":{}}'].join(
    '\n',
  )
  const strict = parseNdjson(text)
  assert.equal(strict.events.length, 0)
  const lenient = parseNdjson(text, true)
  assert.equal(lenient.events.length, 1)
  assert.equal(lenient.events[0]!.kind, 'raw')
})

test('parseNdjson: 乱序 seq 会被稳定排序', () => {
  const ev = (seq: number): string =>
    serializeEvent({ v: 1, seq, t: seq, run: 'r', session: '', agent: '', kind: 'raw', data: {} })
  const res = parseNdjson([ev(2), ev(0), ev(1)].join('\n'))
  assert.deepEqual(
    res.events.map((e) => e.seq),
    [0, 1, 2],
  )
})

test('loadNdjson 读回的内容与写入完全一致（无损往返）', () => {
  const file = new URL('../fixtures/mission-demo.ndjson', import.meta.url)
  const text = readFileSync(file, 'utf8')
  const a = parseNdjson(text)
  const b = parseNdjson(a.events.map(serializeEvent).join('\n'))
  assert.deepEqual(a.events, b.events)
})
