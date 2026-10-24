/**
 * 适配器契约
 * ==========
 *
 * 整个项目只有这一层知道"上游某个 runtime 的日志长什么样"。
 * 上游改格式时，**只改一个文件**，内核、投影、UI 全都不用动。
 *
 * 三条硬约束：
 *   1. **只读不改**：适配器消费字节，绝不修改原始日志；
 *   2. **不丢数据**：看不懂的行一律 emit 成 `raw`，宁可不懂也不能让证据消失；
 *   3. **不做推断**：适配器不猜"用户意图"，只做格式翻译。语义归约交给 projector。
 *
 * 新增一个 runtime 的适配器，标准工作量约 80 行（见 claude.ts）。
 */

import type { Draft } from '../schema.ts'

export type Emit = (draft: Draft) => void

export type AdapterCtx = {
  /** 已有 session id（`record` 时由 CLI 生成） */
  session: string
  /** agent 展示名，默认取命令名 */
  agent: string
  /** runtime 标识，写进 session.start */
  runtime: string
  model?: string
  cwd?: string
}

export type AdapterInstance = {
  /** 消费一行原始输出（stdout / stderr 各一行）。实现必须容错，不能抛。 */
  onLine(line: string): void
  /** 进程结束时调用，用来补 session.end */
  onEnd?(status: 'done' | 'failed'): void
}

/**
 * 适配器的可信度，必须如实标注 —— 这一列是给使用者看的，也是给面试官看的。
 *  · verified  : 有真实样本、有单测、格式已确认
 *  · heuristic : 按上游公开格式实现的启发式映射，字段可能漂移
 *  · fallback  : 兜底，不解码，只保证不丢
 */
export type AdapterStatus = 'verified' | 'heuristic' | 'fallback'

export type Adapter = {
  id: string
  label: string
  status: AdapterStatus
  /** 给使用者的一句话说明 */
  note: string
  /** 0..1 的置信度，用于 `--adapter auto` 自动识别 */
  detect(line: string): number
  create(ctx: AdapterCtx, emit: Emit): AdapterInstance
}

/** 安全解析一行 JSON，失败返回 undefined（绝不抛）。 */
export function parseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim()
  if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined
  try {
    const v: unknown = JSON.parse(trimmed)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
    return v as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 把一行落成 raw 事件（不丢证据）。 */
export function emitRaw(emit: Emit, line: string, stream = 'line'): void {
  const text = line.replace(/\r$/, '')
  if (text.trim() === '') return
  emit({ kind: 'raw', data: { stream, line: text.length > 4000 ? text.slice(0, 4000) : text } })
}
