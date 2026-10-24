/**
 * NDJSON 读写 —— 黑匣子文件格式
 *
 * 为什么是 NDJSON 而不是 SQLite / Parquet：
 *   · **`tail -f` 可读**：出问题的时候人能用眼睛看，不需要工具；
 *   · **`| jq` 可查**：一行一个事件，grep/jq 立刻能用；
 *   · **追加写**：崩溃最多丢最后半行，不会毁掉整个文件；
 *   · **跨语言**：任何 runtime 都能吐这个格式，适配器可以不是 TypeScript 写的。
 *
 * 代价是文件偏大、随机查询要靠索引 —— 索引在内存里构建（见 projector.ts）。
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  SCHEMA_VERSION,
  validateEvent,
  type Draft,
  type Event,
} from './schema.ts'

export type ParseIssue = { line: number; error: string }

export type ParseResult = {
  events: Event[]
  /** 被丢弃的行数（非法 JSON / envelope 不合法） */
  skipped: number
  /** 最多保留前 20 条错误，够定位就行 */
  issues: ParseIssue[]
}

/**
 * 解析 NDJSON 文本。
 *
 * @param lenient 为 true 时，kind 未知的行会降级为 `raw` 事件而不是丢弃。
 *                录制未知 runtime 的输出时用得上。
 */
export function parseNdjson(text: string, lenient = false): ParseResult {
  const events: Event[] = []
  const issues: ParseIssue[] = []
  let skipped = 0
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw === undefined) break
    const line = raw.trim()
    if (line === '') continue

    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      skipped++
      if (issues.length < 20) issues.push({ line: i + 1, error: 'invalid JSON' })
      continue
    }

    const res = validateEvent(obj)
    if (res.ok) {
      events.push(res.event)
      continue
    }

    if (lenient && typeof obj === 'object' && obj !== null) {
      const o = obj as Record<string, unknown>
      const salvaged: Event = {
        v: SCHEMA_VERSION,
        seq: typeof o.seq === 'number' ? o.seq : events.length,
        t: typeof o.t === 'number' ? o.t : 0,
        run: typeof o.run === 'string' && o.run ? o.run : 'imported',
        session: typeof o.session === 'string' ? o.session : '',
        agent: typeof o.agent === 'string' ? o.agent : 'unknown',
        kind: 'raw',
        data: { stream: 'salvaged', line },
      }
      events.push(salvaged)
      skipped++
      if (issues.length < 20) issues.push({ line: i + 1, error: `${res.error} (降级为 raw)` })
      continue
    }

    skipped++
    if (issues.length < 20) issues.push({ line: i + 1, error: res.error })
  }

  // seq 是唯一排序依据；外部日志可能乱序（并发写入），这里稳定排序兜底。
  events.sort((a, b) => a.seq - b.seq)

  return { events, skipped, issues }
}

export function loadNdjson(file: string, lenient = false): ParseResult {
  return parseNdjson(readFileSync(file, 'utf8'), lenient)
}

export function serializeEvent(event: Event): string {
  return JSON.stringify(event)
}

/** 一次性覆盖写（生成 fixture / 导出用）。 */
export function writeNdjson(file: string, events: Event[]): void {
  const dir = dirname(file)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  const fd = openSync(file, 'w')
  try {
    const buf: string[] = []
    for (const e of events) buf.push(serializeEvent(e))
    writeSync(fd, buf.length > 0 ? buf.join('\n') + '\n' : '')
  } finally {
    closeSync(fd)
  }
}

export type RecorderOptions = {
  file: string
  run: string
  /** 默认 session id（适配器没给的时候用） */
  session?: string
  /** 默认 agent 名 */
  agent?: string
  /** 逻辑时间原点，默认 now */
  t0?: number
  /**
   * 合成时钟步长（ms）。设置后忽略墙钟，每条事件固定 +tStep —— 用于
   * `ingest` 已有日志的场景：源日志没有逐行时间戳，只能给出**顺序正确但
   * 时间绝对值是合成的**时间轴。这比让所有事件的 t=0（时间轴失效）诚实。
   */
  tStep?: number
  /** 是否在第一次写入时打印文件头提示（CLI 用） */
  quiet?: boolean
}

/**
 * 追加式录制器。
 *
 * 唯一职责：把 `Draft` 变成合法的、seq 单调、t 单调的 `Event` 并立刻落盘。
 * 每写一条就 `writeSync` —— 崩溃时最多丢一条，换来的是"tab 崩了黑匣子还在"。
 */
export class Recorder {
  #fd: number
  #file: string
  #run: string
  #session: string
  #agent: string
  #t0: number
  #tStep: number | null
  #seq = 0
  #lastT = 0
  #closed = false
  #count = 0

  constructor(opts: RecorderOptions) {
    const dir = dirname(opts.file)
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.#fd = openSync(opts.file, 'a')
    this.#file = opts.file
    this.#run = opts.run
    this.#session = opts.session ?? ''
    this.#agent = opts.agent ?? ''
    this.#t0 = opts.t0 ?? Date.now()
    this.#tStep = typeof opts.tStep === 'number' && opts.tStep > 0 ? opts.tStep : null
  }

  get file(): string {
    return this.#file
  }

  get run(): string {
    return this.#run
  }

  get count(): number {
    return this.#count
  }

  /** 写入一条事件。t 保证单调不减：适配器给的时间戳乱序时会被夹住。 */
  push(draft: Draft): Event {
    if (this.#closed) throw new Error('recorder is closed')
    const rawT =
      draft.t ??
      (this.#tStep === null
        ? Date.now() - this.#t0
        : this.#count === 0
          ? 0
          : this.#lastT + this.#tStep)
    const t = Math.max(this.#lastT, Math.max(0, Math.round(rawT)))
    this.#lastT = t

    const event: Event = {
      v: SCHEMA_VERSION,
      seq: this.#seq++,
      t,
      run: this.#run,
      session: draft.session ?? this.#session,
      agent: draft.agent ?? this.#agent,
      kind: draft.kind,
      data: draft.data ?? {},
    }
    if (draft.call) event.call = draft.call

    writeSync(this.#fd, serializeEvent(event) + '\n')
    this.#count++
    return event
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    closeSync(this.#fd)
  }
}

/**
 * NDJSON 增量尾随器。
 *
 * live 模式每 300~500ms 轮询一次，**只读新增字节** —— 复杂度 O(新增量)，
 * 与文件总大小无关。写端可能正好写了一半，所以只处理到最后一个换行符，
 * 剩下的半行留到下一轮（丢掉一条日志比读到半个 JSON 安全得多）。
 */
export class NdjsonTail {
  #file: string
  #offset = 0
  #primed = false

  constructor(file: string) {
    this.#file = file
  }

  get offset(): number {
    return this.#offset
  }

  /** 首次全量读取 */
  prime(): ParseResult {
    this.#primed = true
    return this.#read()
  }

  /** 增量读取；没有新内容时返回空结果 */
  poll(): ParseResult {
    if (!this.#primed) return this.prime()
    return this.#read()
  }

  #read(): ParseResult {
    const empty: ParseResult = { events: [], skipped: 0, issues: [] }
    let size: number
    try {
      size = statSync(this.#file).size
    } catch {
      return empty
    }
    if (size <= this.#offset) return empty

    const length = size - this.#offset
    const buf = Buffer.allocUnsafe(length)
    let read = 0
    try {
      const fd = openSync(this.#file, 'r')
      try {
        read = readSync(fd, buf, 0, length, this.#offset)
      } finally {
        closeSync(fd)
      }
    } catch {
      return empty
    }
    if (read <= 0) return empty

    const chunk = buf.subarray(0, read)
    const nl = chunk.lastIndexOf(0x0a)
    if (nl < 0) return empty // 半行，等下一轮
    const text = chunk.subarray(0, nl + 1).toString('utf8')
    this.#offset += nl + 1
    return parseNdjson(text, true)
  }
}
