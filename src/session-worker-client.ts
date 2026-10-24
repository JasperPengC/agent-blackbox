/**
 * 会话解码 worker（主线程这一侧的封装）
 *
 * 常驻而不是一次性：每次打开会话都新建 worker 要付 ~40ms 启动成本，
 * 而解码本身就是几百毫秒 —— 这笔开销完全没必要。
 * 空闲 15 秒后自动回收，不占资源。
 */
import { Worker } from 'node:worker_threads'
import type { Event } from './schema.ts'
import type { SourceSession } from './sources.ts'

const WORKER_FILE = import.meta.url.endsWith('.js') ? './session-worker.js' : './session-worker.ts'
const IDLE_MS = 15_000

type Pending = { resolve: (v: { events: Event[]; cached: boolean }) => void; reject: (e: Error) => void }
let worker: Worker | null = null
let seq = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (worker) return worker
  const w = new Worker(new URL(WORKER_FILE, import.meta.url))
  w.on('message', (msg: { id: number; ok: boolean; events?: Event[]; cached?: boolean; error?: string }) => {
    const job = pending.get(msg.id)
    pending.delete(msg.id)
    if (!job) return
    if (msg.ok && msg.events) job.resolve({ events: msg.events, cached: msg.cached === true })
    else job.reject(new Error(msg.error ?? '解码失败'))
    scheduleIdle()
  })
  w.on('error', (err) => {
    for (const job of pending.values()) job.reject(err)
    pending.clear()
    w.terminate()
    worker = null
  })
  w.unref()
  worker = w
  return w
}

function scheduleIdle(): void {
  if (pending.size > 0) return
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    worker?.terminate()
    worker = null
  }, IDLE_MS)
  idleTimer.unref?.()
}

export function buildInWorker(
  session: SourceSession,
  full: boolean,
): Promise<{ events: Event[]; cached: boolean }> {
  // 测试/受限环境可强制主线程解码（worker 在 node:test 里会拖住进程退出）
  if (process.env['BLACKBOX_NO_WORKER'] === '1') {
    return Promise.reject(new Error('worker disabled by BLACKBOX_NO_WORKER'))
  }
  return new Promise((resolve, reject) => {
    const w = ensureWorker()
    const id = ++seq
    pending.set(id, { resolve, reject })
    // 兜底超时：worker 卡死时不要永远挂着
    const timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('会话解码超时（120s）'))
    }, 120_000)
    timer.unref?.()
    w.postMessage({ id, file: session.file, full })
  })
}
