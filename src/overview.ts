/**
 * 多会话总览 —— CLI 与 Web 共用同一份计算
 *
 * 三件事：
 *   1. 扫所有 runtime 的会话（`sources.discoverAll`）；
 *   2. **按 (文件, 大小, mtime) 缓存统计结果** —— 105 个会话冷启动 5s，热启动毫秒级；
 *   3. 用价格表把 token 折算成成本；**查不到价格的就标出来，绝不编数字**。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAdapter } from './adapters/index.ts'
import { estimateCost, loadPricing, normalizeModel, type Pricing } from './pricing.ts'
import { discoverAll, summarizeSession, type SessionSummary, type SourceSession, type ToolStat } from './sources.ts'

export type OverviewRow = {
  runtime: string
  sessionId: string
  project: string
  /** 会话标题（DSH 侧栏那个） */
  title?: string
  file: string
  size: number
  mtime: number
  events: number
  toolCalls: number
  toolFails: number
  tokens: { in: number; out: number; cached: number }
  durationMs: number
  models: string[]
  /** 估算成本（展示币种）；undefined = 有模型缺价格 */
  cost?: number
  missingPrice: boolean
  /** 因为文件过大没统计 */
  skipped?: boolean
}

export type OverviewResult = {
  rows: OverviewRow[]
  discovered: number
  scanned: number
  skippedLarge: number
  currency: string
  pricingNote: string
  unpricedModels: string[]
  totals: { tokens: { in: number; out: number; cached: number }; cost: number }
}

export type CacheEntry = Omit<OverviewRow, 'runtime' | 'sessionId' | 'project' | 'file' | 'size' | 'mtime' | 'missingPrice' | 'skipped'> & {
  size: number
  mtime: number
  /** 扫描时间（ms）。活会话 mtime/size 一直在变，靠它做"陈旧但可接受"的复用 */
  scannedAt?: number
  title?: string
}

/** 缓存格式版本：字段一变就让旧缓存失效，避免读到"半新半旧"的数据 */
const CACHE_VERSION = 5

export type Cache = Record<string, CacheEntry>
type CacheFile = { version: number; entries: Cache }

function cachePath(): string {
  return process.env['BLACKBOX_CACHE'] ?? join(homedir(), '.dsh', 'blackbox', 'overview-cache.json')
}

export function loadCache(): Cache {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheFile
    if (raw.version !== CACHE_VERSION) return {}
    return raw.entries ?? {}
  } catch {
    return {}
  }
}

export function saveCache(cache: Cache): void {
  try {
    const path = cachePath()
    mkdirSync(join(path, '..'), { recursive: true })
    const payload: CacheFile = { version: CACHE_VERSION, entries: cache }
    writeFileSync(path, JSON.stringify(payload))
  } catch {
    /* 缓存不是正确性的一部分 */
  }
}

function entryOf(summary: SessionSummary): CacheEntry {
  const entry: EntryWithModels = {
    scannedAt: Date.now(),
    size: summary.session.size,
    mtime: summary.session.mtime,
    events: summary.events,
    toolCalls: summary.toolCalls,
    toolFails: summary.toolFails,
    tokens: summary.tokens,
    durationMs: summary.durationMs,
    models: summary.models,
    tokensByModel: summary.byModel,
    tools: summary.tools,
    blockedMs: summary.blockedMs,
    checkpoints: summary.checkpoints,
    goal: summary.goal,
    title: summary.title,
  }
  return entry
}

export type EntryWithModels = CacheEntry & {
  tokensByModel?: Record<string, { in: number; out: number; cached: number }>
  tools?: Record<string, ToolStat>
  blockedMs?: number
  checkpoints?: number
  goal?: string
}

export type ComputeOptions = {
  limit?: number
  runtime?: string
  useCache?: boolean
  /** 统计进度回调（CLI 打点用） */
  onProgress?: (done: number, total: number) => void
}

export function computeOverview(pricing: Pricing = loadPricing(), opts: ComputeOptions = {}): OverviewResult {
  const all = discoverAll().filter((s) => opts.runtime === undefined || s.runtime === opts.runtime)
  const limit = opts.limit ?? 40
  const targets = Number.isFinite(limit) ? all.slice(0, limit) : all
  const useCache = opts.useCache !== false
  /** 活会话 60 秒内不重扫：否则每次刷新都在重算同一个正在写的文件 */
  const STALE_REUSE_MS = 60_000
  const cache = useCache ? loadCache() : {}
  const next: Cache = {}
  const rows: OverviewRow[] = []
  let skippedLarge = 0
  let scanned = 0

  for (let i = 0; i < targets.length; i++) {
    const session = targets[i]!
    opts.onProgress?.(i + 1, targets.length)
    const key = session.file
    let entry = cache[key] as EntryWithModels | undefined
    const fresh = entry !== undefined && entry.size === session.size && entry.mtime === session.mtime
    // 注意：**不要求 size 相同**。正在写入的会话每秒都在变大，
    // 要求 size 一致等于永远不命中缓存 —— 这正是"compare 每次重算 7 秒"的根因。
    const acceptableStale =
      entry !== undefined &&
      typeof entry.scannedAt === 'number' &&
      Date.now() - entry.scannedAt < STALE_REUSE_MS
    if (!fresh && !acceptableStale) {
      const adapter = getAdapter(session.adapter)
      if (!adapter) continue
      const summary = summarizeSession(session, adapter)
      scanned++
      if (!summary) {
        skippedLarge++
        continue
      }
      entry = entryOf(summary) as EntryWithModels
      entry.tokensByModel = summary.byModel
    }
    if (entry === undefined) continue
    next[key] = entry
    rows.push(rowOf(session, entry, pricing))
  }
  if (useCache) saveCache({ ...cache, ...next })

  const unpriced = new Set<string>()
  let totalCost = 0
  const totals = { tokens: { in: 0, out: 0, cached: 0 }, cost: 0 }
  for (const r of rows) {
    totals.tokens.in += r.tokens.in
    totals.tokens.out += r.tokens.out
    totals.tokens.cached += r.tokens.cached
    if (r.cost !== undefined) totalCost += r.cost
    if (r.missingPrice) {
      for (const m of r.models) if (!pricing.models[normalizeModel(m)]) unpriced.add(m)
    }
  }
  totals.cost = totalCost

  return {
    rows,
    discovered: all.length,
    scanned,
    skippedLarge,
    currency: pricing.displayCurrency,
    pricingNote: pricing.note,
    unpricedModels: [...unpriced].sort(),
    totals,
  }
}

function rowOf(session: SourceSession, entry: EntryWithModels, pricing: Pricing): OverviewRow {
  const byModel = entry.tokensByModel ?? {}
  let cost = 0
  let missingPrice = false
  for (const [model, tokens] of Object.entries(byModel)) {
    const r = estimateCost(pricing, model, tokens)
    if (r.missing) missingPrice = true
    else cost += r.cost ?? 0
  }
  const base: OverviewRow = {
    runtime: session.runtime,
    sessionId: session.sessionId,
    project: session.project,
    ...(entry.title ? { title: entry.title } : {}),
    file: session.file,
    size: session.size,
    mtime: session.mtime,
    events: entry.events,
    toolCalls: entry.toolCalls,
    toolFails: entry.toolFails,
    tokens: entry.tokens,
    durationMs: entry.durationMs,
    models: entry.models,
    missingPrice,
  }
  if (!missingPrice) base.cost = cost
  return base
}

export function hasSessionFile(file: string): boolean {
  return existsSync(file)
}
