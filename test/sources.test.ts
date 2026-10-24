/**
 * 多 runtime 发现层 + 成本估算的测试。
 *
 * 这一层的价值全在"格式细节"上：路径规则、别名、币种折算。
 * 用临时目录造三家的目录结构，不依赖本机真实会话。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeClaudeProject, discoverAll, TextTail, type Roots } from '../src/sources.ts'
import { estimateCost, findPrice, loadPricing, normalizeModel } from '../src/pricing.ts'

function fakeTree(): { roots: Roots; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'bb-src-'))
  const roots: Roots = {
    dsh: join(base, 'dsh'),
    claude: join(base, 'claude'),
    codex: join(base, 'codex'),
  }
  // DSH：<project>/session-<uuid>/session.v4.jsonl.zstd
  mkdirSync(join(roots.dsh, '--Users-me-proj--', 'session-abc'), { recursive: true })
  writeFileSync(join(roots.dsh, '--Users-me-proj--', 'session-abc', 'session.v4.jsonl.zstd'), 'x')
  // Claude：<slug>/<uuid>.jsonl
  mkdirSync(join(roots.claude, '-Users-me-proj'), { recursive: true })
  writeFileSync(join(roots.claude, '-Users-me-proj', 'sess-1.jsonl'), '{"a":1}\n')
  // Codex：YYYY/MM/DD/rollout-*.jsonl
  mkdirSync(join(roots.codex, '2026', '10', '21'), { recursive: true })
  writeFileSync(
    join(roots.codex, '2026', '10', '21', 'rollout-2026-10-21T22-40-16-01a15ee7-dd4e.jsonl'),
    '{"a":1}\n',
  )
  return { roots, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

test('discoverAll: 三种 runtime 的目录结构都能认出来', () => {
  const { roots, cleanup } = fakeTree()
  try {
    const all = discoverAll(roots)
    assert.equal(all.length, 3)
    const dsh = all.find((s) => s.runtime === 'dsh')!
    assert.equal(dsh.adapter, 'dsh')
    assert.equal(dsh.format, 'zstd-jsonl')
    assert.equal(dsh.sessionId, 'session-abc')
    const claude = all.find((s) => s.runtime === 'claude-code')!
    assert.equal(claude.adapter, 'claude-code')
    assert.equal(claude.format, 'jsonl')
    const codex = all.find((s) => s.runtime === 'codex')!
    assert.equal(codex.adapter, 'codex-session')
    assert.equal(codex.sessionId, '01a15ee7-dd4e')
  } finally {
    cleanup()
  }
})

test('decodeClaudeProject: cwd 变形能还原', () => {
  assert.equal(decodeClaudeProject('-Users-me-proj'), '/Users/me/proj')
  assert.equal(decodeClaudeProject('plain'), 'plain')
})

test('TextTail: 只读新增字节，半行留到下一轮', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-tail-'))
  const file = join(dir, 's.jsonl')
  try {
    writeFileSync(file, '{"a":1}\n{"a":2}\n')
    const tail = new TextTail(file)
    assert.deepEqual(tail.poll(), ['{"a":1}', '{"a":2}'])
    assert.deepEqual(tail.poll(), [])
    // 追加半行：不应被读出来
    writeFileSync(file, '{"a":1}\n{"a":2}\n{"a":3', 'utf8')
    assert.deepEqual(tail.poll(), [])
    // 补完换行后一次读出
    writeFileSync(file, '{"a":1}\n{"a":2}\n{"a":3}\n', 'utf8')
    assert.deepEqual(tail.poll(), ['{"a":3}'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pricing: 模型名归一化与 provider 别名', () => {
  assert.equal(normalizeModel('DeepSeek-V4.1-Flash'), 'deepseek-v4-1-flash')
  const pricing = loadPricing()
  const price = findPrice(pricing, 'cline-pass/deepseek-v4.1-flash')
  assert.ok(price, 'provider 前缀不应挡住价格匹配')
  assert.equal(price!.currency, 'CNY')
})

test('pricing: 未知模型必须返回 missing，绝不编造', () => {
  const pricing = loadPricing()
  const r = estimateCost(pricing, 'some-brand-new-model-9000', { in: 1e6, out: 1e6, cached: 0 })
  assert.equal(r.missing, true)
  assert.equal(r.cost, undefined)
})

test('pricing: 币种折算与缓存价参与计算', () => {
  const pricing = loadPricing()
  // DeepSeek V4.1-Flash 高峰：CNY 2 / 8 / 0.04 每百万
  const r = estimateCost(pricing, 'deepseek-v4.1-flash', { in: 1e6, out: 1e6, cached: 1e6 })
  assert.ok(!r.missing)
  const cny = 2 + 8 + 0.04
  const expectedUsd = pricing.displayCurrency.toUpperCase() === 'USD' ? cny / (pricing.usdRates['CNY'] ?? 7.2) : cny
  assert.ok(Math.abs((r.cost ?? 0) - expectedUsd) < 1e-6, `成本计算错误：${r.cost} vs ${expectedUsd}`)
})
