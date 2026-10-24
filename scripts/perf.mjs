#!/usr/bin/env node
/**
 * 真实浏览器性能探针（headless Chrome + CDP）。
 *
 * 量四件事，全部是用户能感知的：
 *   1. 导航耗时（domContentLoaded / load）
 *   2. 长任务（>50ms 的主线程阻塞）次数与总时长
 *   3. rAF 帧间隔（模拟"时间轴在播/在拖"时掉不掉帧）
 *   4. JS 堆占用
 *
 * 用法：
 *   node scripts/perf.mjs "http://127.0.0.1:49765/blackbox/?file=/abs/session.zstd" 1600 1000
 */

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [url = 'http://127.0.0.1:7077/', w = '1600', h = '1000'] = process.argv.slice(2)
const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env['PERF_PORT'] ?? 9334)
const profile = mkdtempSync(join(tmpdir(), 'bb-perf-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
   `--remote-debugging-port=${PORT}`, `--window-size=${w},${h}`, `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
)

let failed = false
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break } catch {}
    await sleep(150)
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: Number(w), height: Number(h), deviceScaleFactor: 2, mobile: false })

  // 注入探针：长任务 + rAF 采样
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__perf = { longTasks: [], frames: [], errors: [] }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__perf.longTasks.push(Math.round(e.duration))
        }).observe({ type: 'longtask', buffered: true })
      } catch {}
      window.addEventListener('error', (e) => window.__perf.errors.push(String(e.message)))
      let last = 0
      const tick = (t) => { if (last) window.__perf.frames.push(t - last); last = t; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
    `,
  })

  const navAt = Date.now()
  await send('Page.navigate', { url })

  // 首屏可用：__bb.meta 一旦有值，界面就能渲染了（快照模式下这一步不需要等完整索引）
  // 完整索引：meta.loading === false（大会话此时才真正"补齐"）
  let dataReadyMs = -1
  let indexReadyMs = -1
  for (let i = 0; i < 200; i++) {
    const res = await send('Runtime.evaluate', {
      expression: `(() => {
        const m = window.__bb && window.__bb.meta
        return m ? JSON.stringify({ events: m.eventCount, loading: m.loading === true }) : ''
      })()`,
      returnByValue: true,
    })
    const raw = res.result?.result?.value
    if (raw && dataReadyMs < 0) dataReadyMs = Date.now() - navAt
    if (raw) {
      try {
        const m = JSON.parse(raw)
        if (!m.loading) { indexReadyMs = Date.now() - navAt; break }
      } catch { /* ignore */ }
    }
    await sleep(50)
  }

  // 首次绘制：判断"长任务"到底有没有挡住内容
  let firstPaint = -1
  let fcp = -1
  {
    const res = await send('Runtime.evaluate', {
      expression: `JSON.stringify(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]))`,
      returnByValue: true,
    })
    try {
      const paints = JSON.parse(res.result.result.value || '[]')
      for (const [name, t] of paints) {
        if (name === 'first-paint') firstPaint = t
        if (name === 'first-contentful-paint') fcp = t
      }
    } catch {
      /* ignore */
    }
  }

  // 播放中帧率：点一下播放按钮，再采样 2.5 秒
  const beforePlay = await send('Runtime.evaluate', {
    expression: `(() => { const b = document.querySelector('#btnPlay'); if (b) { b.click(); return true } return false })()`,
    returnByValue: true,
  })
  const played = beforePlay.result?.result?.value === true
  await sleep(2500)

  const result = await send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {}
      const p = window.__perf || { longTasks: [], frames: [], errors: [] }
      const f = p.frames.filter((x) => x > 0).sort((a, b) => a - b)
      const at = (q) => f.length ? Math.round(f[Math.min(f.length - 1, Math.floor(q * f.length))]) : 0
      return JSON.stringify({
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        load: Math.round(nav.loadEventEnd || 0),
        dataReady: ${dataReadyMs},
        indexReady: ${indexReadyMs},
        firstPaint: ${firstPaint},
        fcp: ${fcp},
        playing: ${played},
        longTasks: p.longTasks.length,
        longTaskMs: p.longTasks.reduce((a, b) => a + b, 0),
        worstLongTask: p.longTasks.length ? Math.max(...p.longTasks) : 0,
        frames: f.length,
        frameMedian: at(0.5),
        frameP95: at(0.95),
        frameWorst: f.length ? Math.round(f[f.length - 1]) : 0,
        droppedOver50ms: f.filter((x) => x > 50).length,
        heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576 * 10) / 10,
        errors: p.errors,
      })
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  const raw = result.result?.result?.value
  if (!raw) throw new Error('probe returned nothing')
  const r = JSON.parse(raw)

  const fmt = (v) => (v >= 0 ? String(v) : '-')
  process.stdout.write(
    [
      '',
      `URL          ${url}`,
      `DOMContentLoaded ${fmt(r.domContentLoaded)}ms   load ${fmt(r.load)}ms   首次绘制 ${r.firstPaint < 0 ? '—' : r.firstPaint + 'ms'}   FCP ${r.fcp < 0 ? '—' : r.fcp + 'ms'}`,
      `首屏可用 ${r.dataReady < 0 ? '超时' : r.dataReady + 'ms'}   索引就绪 ${r.indexReady < 0 ? '超时' : r.indexReady + 'ms'}`,
      `长任务       ${r.longTasks} 个 / 合计 ${r.longTaskMs}ms（最长 ${r.worstLongTask}ms）`,
      `帧间隔       中位 ${r.frameMedian}ms · p95 ${r.frameP95}ms · 最差 ${r.frameWorst}ms · >50ms 掉帧 ${r.droppedOver50ms}`,
      `JS 堆        ${r.heapMB}MB`,
      r.errors.length ? `页面报错     ${r.errors.join(' | ')}` : '',
      '',
    ].filter(Boolean).join('\n'),
  )
  if (r.errors.length) failed = true
} catch (err) {
  process.stderr.write(`✖ ${err instanceof Error ? err.message : String(err)}\n`)
  failed = true
} finally {
  chrome.kill('SIGKILL')
  if (failed) process.exit(1)
}
