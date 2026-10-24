/**
 * agent-blackbox · event schema v1
 * =================================
 *
 * 一条事件就是"黑匣子"里的一帧。设计目标：
 *
 *  1. **可归约**：任何一个事件都必须能被一个纯函数 reducer 消化，不需要回问外部状态。
 *  2. **可序列化**：只用 JSON 基础类型，没有 Date / Map / Set / class 实例。
 *  3. **不丢信息**：适配器看不懂的行一律落成 `raw` 事件，宁可不懂也不能丢。
 *  4. **可演进**：`v` 字段 + 未知 `kind` 被容忍而不是被拒绝（前向兼容）。
 *
 * 兼容性原则：**consumer 容忍未知字段，producer 只写已知字段**。
 */

export const SCHEMA_VERSION = 1 as const

/** 事件类型。加新类型是 minor 变更；删/改语义是 major 变更。 */
export const KINDS = [
  'run.start',
  'run.end',
  'session.start',
  'session.end',
  'edge',
  'status',
  'message.user',
  'message.agent',
  'think',
  'tool.call',
  'tool.result',
  'file.edit',
  'usage',
  'error',
  'checkpoint',
  'subagent',
  'raw',
] as const

export type Kind = (typeof KINDS)[number]

const KIND_SET: ReadonlySet<string> = new Set<string>(KINDS)

/** agent 在某一时刻的状态。`waiting` 是"等外部事件"，`blocked` 是"被人挡住"。 */
export const SESSION_STATES = [
  'idle',
  'thinking',
  'tool',
  'waiting',
  'blocked',
  'done',
  'failed',
] as const

export type SessionStateName = (typeof SESSION_STATES)[number]

export type EventData = Record<string, unknown>

/**
 * 归一化事件。所有适配器的输出都长这样，`run`/`session`/`agent`/`seq`/`t`
 * 由录制层统一补齐，适配器只需要给出"发生了什么"。
 */
export type Event = {
  /** schema 版本 */
  v: number
  /** run 内单调递增序号，从 0 开始，是唯一的排序依据 */
  seq: number
  /** 逻辑时间：相对 run 起点的毫秒数。回放只认 `t`，不认墙钟 */
  t: number
  /** run id，一个黑匣子文件 = 一个 run */
  run: string
  /** session id，run 级事件为空串 */
  session: string
  /** agent 展示名（角色名），用于 UI 节点 */
  agent: string
  kind: Kind
  /** tool call 关联 id：call 与 result 靠它配对 */
  call?: string
  data: EventData
}

/** 适配器产出的"半成品事件"：录制层会补 seq / t / run / session / agent。 */
export type Draft = {
  kind: Kind
  session?: string
  agent?: string
  call?: string
  /** 有源时间戳时填它；没有就由录制层按墙钟补齐 */
  t?: number
  data?: EventData
}

// ────────────────────────────────────────────────────────────────────────────
// 每种 kind 的 data 形状（文档 + 类型，宽松校验：缺字段不致命，类型错则丢弃）
// ────────────────────────────────────────────────────────────────────────────

/** run.start   { goal?, wall? } */
export type RunStartData = { goal?: string; wall?: string }
/** run.end     { status: 'done' | 'failed', reason? } */
export type RunEndData = { status?: 'done' | 'failed'; reason?: string }
/** session.start { runtime, model?, role?, cwd?, color? } */
export type SessionStartData = {
  runtime?: string
  model?: string
  role?: string
  cwd?: string
  color?: string
}
/** session.end { status?: 'done' | 'failed' } */
export type SessionEndData = { status?: 'done' | 'failed' }
/** edge        { from, to, kind?: 'delegate' | 'handoff' | 'ask' | 'reply', label? } */
export type EdgeData = {
  from?: string
  to?: string
  kind?: string
  label?: string
}
/** status      { state, waitingFor?, reason? } —— 归因面板的全部信息来源 */
export type StatusData = {
  state?: SessionStateName
  waitingFor?: string
  reason?: string
}
/** message.user  { text } */
export type MessageUserData = { text?: string }
/** message.agent { text, final? } */
export type MessageAgentData = { text?: string; final?: boolean }
/** think       { text } */
export type ThinkData = { text?: string }
/** tool.call   { tool, input?, summary? } */
export type ToolCallData = { tool?: string; input?: unknown; summary?: string }
/** tool.result { ok, ms?, output?, error? } */
export type ToolResultData = {
  ok?: boolean
  ms?: number
  output?: string
  error?: string
}
/** file.edit   { path, added?, removed? } */
export type FileEditData = { path?: string; added?: number; removed?: number }
/** usage       { in, out, cached?, costUsd? } */
export type UsageData = { in?: number; out?: number; cached?: number; costUsd?: number }
/** error       { message, fatal? } */
export type ErrorData = { message?: string; fatal?: boolean }
/** checkpoint  { name?, note? } —— 语义标记，不影响状态 */
export type CheckpointData = { name?: string; note?: string }
/** raw         { stream: 'stdout' | 'stderr' | 'line', line } */
export type RawData = { stream?: string; line?: string }

/** kind → 展示元数据。UI 与终端共用，避免两处颜色不一致。 */
export const KIND_META: Record<Kind, { label: string; color: string; glyph: string }> = {
  'run.start': { label: '任务开始', color: '#6ee7b7', glyph: '▶' },
  'run.end': { label: '任务结束', color: '#34d399', glyph: '■' },
  'session.start': { label: '会话启动', color: '#60a5fa', glyph: '◉' },
  'session.end': { label: '会话结束', color: '#93c5fd', glyph: '◎' },
  edge: { label: '委派/交接', color: '#f472b6', glyph: '⤳' },
  status: { label: '状态', color: '#fbbf24', glyph: '◆' },
  'message.user': { label: '用户消息', color: '#a78bfa', glyph: '👤' },
  'message.agent': { label: 'Agent 发言', color: '#c4b5fd', glyph: '🤖' },
  think: { label: '思考', color: '#94a3b8', glyph: '💭' },
  'tool.call': { label: '工具调用', color: '#38bdf8', glyph: '🔧' },
  'tool.result': { label: '工具返回', color: '#0ea5e9', glyph: '↩' },
  'file.edit': { label: '改文件', color: '#fb923c', glyph: '✎' },
  usage: { label: '用量', color: '#4ade80', glyph: '⛽' },
  error: { label: '错误', color: '#f87171', glyph: '✖' },
  checkpoint: { label: '检查点', color: '#e879f9', glyph: '⚑' },
  subagent: { label: '子 agent', color: '#a78bfa', glyph: '⧉' },
  raw: { label: '原始行', color: '#64748b', glyph: '·' },
}

/** agent 节点配色，按出现顺序取。 */
export const AGENT_PALETTE = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#e879f9',
] as const

export function isKind(x: unknown): x is Kind {
  return typeof x === 'string' && KIND_SET.has(x)
}

export type ValidateOk = { ok: true; event: Event }
export type ValidateErr = { ok: false; error: string }
export type ValidateResult = ValidateOk | ValidateErr

/**
 * 校验一条**已归一化**的事件。这里刻意只做 envelope 校验：
 * `data` 的形状由各 kind 的语义决定，reducer 对缺失字段是容错的，
 * 因此把 data 校验得更严只会让工具因为上游加字段而变脆。
 */
export function validateEvent(x: unknown): ValidateResult {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) {
    return { ok: false, error: 'not an object' }
  }
  const o = x as Record<string, unknown>

  if (typeof o.v !== 'number' || !Number.isFinite(o.v)) {
    return { ok: false, error: 'v must be a number' }
  }
  if (o.v > SCHEMA_VERSION) {
    return { ok: false, error: `unsupported schema version v=${o.v} (max ${SCHEMA_VERSION})` }
  }
  if (typeof o.seq !== 'number' || !Number.isInteger(o.seq) || o.seq < 0) {
    return { ok: false, error: 'seq must be a non-negative integer' }
  }
  if (typeof o.t !== 'number' || !Number.isFinite(o.t) || o.t < 0) {
    return { ok: false, error: 't must be a non-negative finite number' }
  }
  if (typeof o.run !== 'string' || o.run.length === 0) {
    return { ok: false, error: 'run must be a non-empty string' }
  }
  if (typeof o.session !== 'string') return { ok: false, error: 'session must be a string' }
  if (typeof o.agent !== 'string') return { ok: false, error: 'agent must be a string' }
  if (!isKind(o.kind)) {
    // 未知 kind 不算坏数据：报错由调用方决定是否容忍（见 parseNdjson 的 lenient）
    return { ok: false, error: `unknown kind: ${String(o.kind)}` }
  }
  if (typeof o.data !== 'object' || o.data === null || Array.isArray(o.data)) {
    return { ok: false, error: 'data must be an object' }
  }

  const event: Event = {
    v: o.v,
    seq: o.seq,
    t: o.t,
    run: o.run,
    session: o.session,
    agent: o.agent,
    kind: o.kind,
    data: o.data as EventData,
  }
  if (typeof o.call === 'string' && o.call.length > 0) event.call = o.call
  return { ok: true, event }
}

// ────────────────────────────────────────────────────────────────────────────
// 容错取值：上游数据不可信，所有 reducer 都走这几个函数
// ────────────────────────────────────────────────────────────────────────────

export function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v)
}

export function asNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** 截断长文本，避免一条工具输出把内存和 UI 撑爆。 */
export function clip(text: string, max = 280): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}… (+${text.length - max})`
}
