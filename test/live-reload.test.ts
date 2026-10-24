/**
 * 实时跟随：会话文件增长时索引要增量扩展
 * ======================================
 * 之前插件宿主用 follow:false 创建路由，面板里永远不会刷新；
 * 另外实时轮询很频繁，文件没变时不能每次重新解码。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

// node:test 里 worker 会拖住进程退出：强制主线程解码
process.env['BLACKBOX_NO_WORKER'] = '1'

import { openSessionSource } from '../src/session-source.ts'

const frame = (line: unknown): Buffer => zstdCompressSync(Buffer.from(`${JSON.stringify(line)}\n`))

function makeSession(): { file: string; append: (line: unknown) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'bb-live-'))
  const project = join(dir, '--proj--')
  const sessionDir = join(project, 'session-live')
  mkdirSync(sessionDir, { recursive: true })
  const file = join(sessionDir, 'session.v4.jsonl.zstd')
  writeFileSync(
    file,
    Buffer.concat([
      frame({ type: 'session', version: 4, id: 'session-live', createdAt: 1_000_000 }),
      frame({ type: 'tool/call', seq: 1, time: 1_001_000, data: { callId: 'c1', name: 'bash', input: 'ls' } }),
    ]),
  )
  return { file, append: (line) => appendFileSync(file, frame(line)) }
}

/** 让 discoverAll 能认得这个会话：文件名/目录结构已经符合 DSH 约定 */

test('follow 会话：文件增长后 reload 返回更多事件', async () => {
  const { file, append } = makeSession()
  const src = openSessionSource(file, true)
  src.reload() // 触发构建（whenReady 只有在 reload 启动构建后才有意义）
  await src.whenReady?.()
  const before = src.reload().events.length
  append({ type: 'tool/call', seq: 2, time: 1_002_000, data: { callId: 'c2', name: 'bash', input: 'pwd' } })
  const after = src.reload().events.length
  assert.ok(after > before, `事件数应增长（${before} → ${after}）`)
})

test('follow 会话：文件没变时 reload 不重复解码（返回同一索引对象）', async () => {
  const { file } = makeSession()
  const src = openSessionSource(file, true)
  src.reload()
  await src.whenReady?.()
  const first = src.reload()
  const second = src.reload()
  assert.equal(first, second, '未变化的文件应复用同一个索引实例')
})
