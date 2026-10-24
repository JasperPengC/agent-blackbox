#!/usr/bin/env node
/**
 * 对比度审计（WCAG 2.1 AA）
 * =========================
 * 用真实浏览器渲染页面，读取关键元素的**实际计算色**（含 alpha 合成），
 * 按 WCAG 公式算对比度，深/浅两套主题各跑一遍。
 *
 * 用法：
 *   node scripts/audit-contrast.mjs "http://127.0.0.1:7811/?t=22000&onboard=off"
 *   node scripts/audit-contrast.mjs <url> --strict     # 有失败则 exit 1（CI 用）
 *   node scripts/audit-contrast.mjs <url> --page=overview
 *
 * 阈值：正文 4.5、大字（≥18.66px 或 ≥14px 粗体）3、非文本（边框/图标）3。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const url = argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:7811/'
const strict = argv.includes('--strict')
const page = (argv.find((a) => a.startsWith('--page=')) ?? '--page=dashboard').split('=')[1]

const CHROME =
  process.env['CHROME_BIN'] ??
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : existsSync('/usr/bin/google-chrome')
      ? '/usr/bin/google-chrome'
      : existsSync('/usr/bin/chromium-browser')
        ? '/usr/bin/chromium-browser'
        : undefined)
if (!CHROME) {
  console.log('⚠ 未找到 Chrome，跳过对比度审计（设置 CHROME_BIN 后重试）')
  process.exit(0)
}

// CI 上多个 job 可能并行；用 pid 派生端口避免偶发占用（可用 AUDIT_PORT 覆盖）
const PORT = Number(process.env['AUDIT_PORT'] ?? 9388 + (process.pid % 500))
const profile = mkdtempSync(join(tmpdir(), 'bb-audit-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 每个页面的探针：selector 是前景，bg 可选（默认向上找不透明背景） */
const PROBES = {
  dashboard: [
    ['.ident-title', '标题', 'text'],
    ['.ident-project', '标题下项目路径', 'text'],
    ['.brand', '品牌', 'text'],
    ['.kpi-k', 'KPI 标签', 'text'],
    ['.kpi-v', 'KPI 数值', 'text'],
    ['.kpi-s', 'KPI 说明', 'text'],
    ['.block-head', '区块标题', 'text'],
    ['.pane-title', '面板标题', 'text'],
    ['.pane-sub', '面板副标题', 'text'],
    ['.agent-name', 'agent 名', 'text'],
    ['.agent-model', 'agent 模型', 'text'],
    ['.agent-foot', 'agent 统计', 'text'],
    ['.agent-feed div', 'agent feed 行', 'text'],
    ['.wf-label', '瀑布标签', 'text'],
    ['.wf-dur', '瀑布耗时', 'text'],
    ['.wf-legend button', '图例按钮', 'text'],
    ['.rrow .t', '事件时间', 'text'],
    ['.rrow .d', '事件内容', 'text'],
    ['.tabs button', '标签页', 'text'],
    ['.tabs button.on', '当前标签页', 'text'],
    ['.pill-btn', '按钮', 'text'],
    ['.foot-meta', '页脚信息', 'text'],
    ['.timecode b', '时钟', 'text'],
    ['.empty', '空态文案', 'text'],
  ],
  overview: [
    ['.ident-title', '标题', 'text'],
    ['.ov-head h1', '页面标题', 'text'],
    ['.sub', '副标题', 'text'],
    ['.stat-k', '统计卡标签', 'text'],
    ['.stat-v', '统计卡数值', 'text'],
    ['thead th', '表头', 'text'],
    ['tbody td', '表格正文', 'text'],
    ['.proj span', '项目路径', 'text'],
    ['.seg button', '筛选按钮', 'text'],
    ['.seg button.on', '当前筛选', 'text'],
    ['.warnbar', '警告条', 'text'],
  ],
  compare: [
    ['.ident-title', '标题', 'text'],
    ['.pick-goal', '会话标题', 'text'],
    ['.pick-meta', '会话元信息', 'text'],
    ['.vs', 'VS', 'text'],
    ['table.metrics td', '指标值', 'text'],
    ['table.metrics td:first-child', '指标名', 'text'],
    ['table.metrics th', '表头', 'text'],
    ['.tool-name', '工具名', 'text'],
    ['.tool-n', '工具次数', 'text'],
    ['.legend', '图例', 'text'],
  ],
}

const chromeArgs = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,900',
  `--user-data-dir=${profile}`,
  // GitHub 的 Linux runner 上 Chrome 需要这两个参数，否则偶发启动失败
  ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  'about:blank',
]
const chrome = spawn(CHROME, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let chromeStderr = ''
let chromeExit = null
chrome.stderr?.on('data', (chunk) => {
  chromeStderr = (chromeStderr + String(chunk)).slice(-2000)
})
chrome.on('exit', (code) => {
  chromeExit = code
})
const killChrome = () => {
  try {
    process.kill(-chrome.pid, 'SIGKILL')
  } catch {
    try {
      chrome.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}
process.on('exit', killChrome)

const sleep2 = sleep

async function main() {
  let ready = false
  for (let i = 0; i < 150; i++) {
    if (chromeExit !== null) {
      throw new Error(`Chrome 启动后立即退出（code=${chromeExit}）：${chromeStderr.trim() || '无 stderr 输出'}`)
    }
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) {
        ready = true
        break
      }
    } catch {
      /* retry */
    }
    await sleep2(200)
  }
  if (!ready) {
    throw new Error(`Chrome DevTools 端点 ${PORT} 在 30s 内未就绪：${chromeStderr.trim() || '无 stderr 输出'}`)
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const target = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m)
      pending.delete(m.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  await send('Runtime.enable')

  const results = []
  for (const theme of ['dark', 'light']) {
    const sep = url.includes('?') ? '&' : '?'
    const target_url = `${url}${sep}theme=${theme}&onboard=off`
    await send('Page.navigate', { url: target_url })
    await sleep2(2600)
    const expr = `(${probeFn.toString()})(${JSON.stringify(PROBES[page])})`
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    const items = JSON.parse(res.result.result.value ?? '[]')
    for (const it of items) results.push({ theme, ...it })
  }

  // ── WCAG 计算 ───────────────────────────────────────────────────────────
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (fg, bg) => {
    const a = lum(fg)
    const b = lum(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }
  const need = (it) => (it.kind === 'border' ? 3 : it.fontSize >= 18.66 || (it.fontSize >= 14 && it.bold) ? 3 : 4.5)

  let fails = 0
  const rows = []
  for (const r of results) {
    if (!r.fg || !r.bg) continue
    const cr = ratio(r.fg, r.bg)
    const req = need(r)
    const ok = cr >= req
    if (!ok) fails++
    rows.push({ ...r, cr, req, ok })
  }

  for (const theme of ['dark', 'light']) {
    const list = rows.filter((r) => r.theme === theme).sort((a, b) => a.cr - b.cr)
    console.log(`\n── ${theme === 'dark' ? '深色' : '浅色'}主题（${page}）──`)
    for (const r of list) {
      const mark = r.ok ? '✓' : '✗'
      console.log(
        `${mark} ${r.label.padEnd(16)} ${r.cr.toFixed(2).padStart(5)} / ${String(r.req).padStart(4)}  ` +
          `${r.fgStr} on ${r.bgStr}${r.missing ? '  (元素不存在)' : ''}`,
      )
    }
  }
  console.log(`\n合计 ${rows.length} 项，失败 ${fails} 项`)
  if (fails > 0 && strict) process.exitCode = 1
}

/** 页面内执行：读取元素实际颜色（含 alpha 合成） */
function probeFn(probes) {
  const parse = (str) => {
    const m = String(str).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] === undefined ? 1 : p[3] }
  }
  const blend = (top, bottom) => ({
    r: Math.round(top.r * top.a + bottom.r * (1 - top.a)),
    g: Math.round(top.g * top.a + bottom.g * (1 - top.a)),
    b: Math.round(top.b * top.a + bottom.b * (1 - top.a)),
    a: 1,
  })
  const effectiveBg = (el) => {
    let cur = el
    let acc = null
    while (cur && cur !== document.documentElement) {
      const c = parse(getComputedStyle(cur).backgroundColor)
      if (c && c.a > 0) acc = acc ? blend(acc, c) : c
      if (acc && acc.a >= 1) return acc
      cur = cur.parentElement
    }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
    return acc ? blend(acc, html) : html
  }
  const out = []
  for (const [sel, label, kind] of probes) {
    const el = document.querySelector(sel)
    if (!el) {
      out.push({ label, kind, missing: true })
      continue
    }
    const cs = getComputedStyle(el)
    const fg = kind === 'border' ? parse(cs.borderTopColor) : parse(cs.color)
    const bg = effectiveBg(el)
    const fontSize = parseFloat(cs.fontSize) || 12
    const bold = Number(cs.fontWeight) >= 600
    const toStr = (c) => (c ? `rgb(${c.r},${c.g},${c.b})` : 'n/a')
    out.push({ label, kind, fg, bg, fgStr: toStr(fg), bgStr: toStr(bg), fontSize, bold })
  }
  return JSON.stringify(out)
}

main()
  .catch((err) => {
    console.error('审计失败：', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => killChrome())
