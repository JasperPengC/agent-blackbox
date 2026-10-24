#!/usr/bin/env node
/**
 * 用 headless Chrome + CDP 给 UI 截图（零依赖、可复现）。
 *
 * 用途有两个：
 *   1. 生成 README 首屏 GIF/PNG 的素材（`npm run shot`）；
 *   2. 让"前端到底算没算对"变成可断言的东西 —— `--eval` 能直接读页面内状态。
 *
 * 用法：
 *   node scripts/shot.mjs http://127.0.0.1:7811/?t=12000 docs/screenshot.png 1600 1000
 *   node scripts/shot.mjs "http://127.0.0.1:7811/" out.png 1600 1000 \
 *     --eval "JSON.stringify(window.__bb.blockedIntervals.map(i => [i.from, i.to]))"
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const evalIdx = argv.indexOf('--eval')
const evalExpr = evalIdx >= 0 ? argv[evalIdx + 1] : undefined
const hoverIdx = argv.indexOf('--hover')
const hoverSel = hoverIdx >= 0 ? argv[hoverIdx + 1] : undefined
const afterIdx = argv.indexOf('--after')
const afterExpr = afterIdx >= 0 ? argv[afterIdx + 1] : undefined
const waitIdx = argv.indexOf('--wait')
const waitMs = waitIdx >= 0 ? Number(argv[waitIdx + 1]) : 2600
const preloadIdx = argv.indexOf('--preload')
const preloadJs = preloadIdx >= 0 ? argv[preloadIdx + 1] : undefined
const blockIdx = argv.indexOf('--block')
const blockPattern = blockIdx >= 0 ? argv[blockIdx + 1] : undefined
// 去掉 --eval/--hover 及其参数，剩下的才是位置参数
const drop = new Set()
if (evalIdx >= 0) { drop.add(evalIdx); drop.add(evalIdx + 1) }
if (hoverIdx >= 0) { drop.add(hoverIdx); drop.add(hoverIdx + 1) }
if (afterIdx >= 0) { drop.add(afterIdx); drop.add(afterIdx + 1) }
if (waitIdx >= 0) { drop.add(waitIdx); drop.add(waitIdx + 1) }
if (preloadIdx >= 0) { drop.add(preloadIdx); drop.add(preloadIdx + 1) }
if (blockIdx >= 0) { drop.add(blockIdx); drop.add(blockIdx + 1) }
const positional = argv.filter((_, i) => !drop.has(i))
const [url = 'http://127.0.0.1:7811/', out = 'shot.png', w = '1600', h = '1000'] = positional

const CHROME =
  process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env['SHOT_PORT'] ?? 9333)
/** 设备像素比：默认 2（Retina 截图）。SHOT_DSF=1 可对照光栅化成本 */
const DSF = Number(process.env['SHOT_DSF'] ?? 2)
const profile = mkdtempSync(join(tmpdir(), 'bb-shot-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs = 12000, step = 150) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for chrome')
    await sleep(step)
  }
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${w},${h}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: true },
)

/**
 * 整个进程组一起杀。
 * 只 kill 启动器是不够的 —— headless Chrome 会留一堆 helper/renderer，
 * 它们会继续吃 CPU，让后续的性能测量（长任务/帧间隔）失真。
 */
function killChrome() {
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

let exitCode = 0
try {
  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    return res.ok
  })

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Page.enable')
  if (blockPattern) {
    await send('Network.enable')
    await send('Network.setBlockedURLs', { urls: [blockPattern] })
  }
  if (preloadJs) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: preloadJs })
  }
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: DSF,
    mobile: false,
  })
  await send('Page.bringToFront')
  await send('Page.navigate', { url })
  await sleep(Number.isFinite(waitMs) ? waitMs : 2600)

  if (evalExpr) {
    const res = await send('Runtime.evaluate', {
      expression: evalExpr,
      returnByValue: true,
      awaitPromise: true,
    })
    const value = res.result?.result?.value
    const thrown = res.result?.exceptionDetails
    process.stdout.write(`${thrown ? 'ERR ' : ''}${JSON.stringify(value)}\n`)
    if (thrown) exitCode = 1
  }

  if (hoverSel) {
    const box = await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(hoverSel)}); if (!el) return ''; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`,
      returnByValue: true,
    })
    const raw = box.result?.result?.value
    if (raw) {
      const { x, y } = JSON.parse(raw)
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
      await sleep(400)
    }
  }
  if (afterExpr) {
    const res = await send('Runtime.evaluate', { expression: afterExpr, returnByValue: true })
    if (res.exceptionDetails) {
      thrown = res.exceptionDetails.exception?.description ?? 'after-eval error'
      exitCode = 1
    } else if (res.result?.result?.value !== undefined) {
      process.stdout.write(`${String(res.result.result.value)}\n`)
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const b64 = shot.result?.data
  if (!b64) throw new Error('screenshot failed')
  writeFileSync(out, Buffer.from(b64, 'base64'))
  process.stdout.write(`✓ ${out} (${Number(w)}x${Number(h)} @2x)\n`)
} catch (err) {
  process.stderr.write(`✖ ${err instanceof Error ? err.message : String(err)}\n`)
  exitCode = 1
} finally {
  killChrome()
  if (exitCode !== 0) process.exit(exitCode)
}
