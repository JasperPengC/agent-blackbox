/**
 * 静态资源一致性
 * ==============
 * 白屏最常见的根因：index.html 引用了 app.js，而 app.js 里 import 的模块
 * 在 web/ 目录里不存在（或插件安装包没带上）——浏览器会静默卡在骨架屏。
 * 这里在 CI 阶段就把这类问题拦住。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../web/', import.meta.url))
const read = (name: string): string => readFileSync(new URL(name, `file://${WEB}`), 'utf8')

test('app.js 里 import 的本地模块都真实存在', () => {
  const app = read('app.js')
  const specs = [...app.matchAll(/from\s+'\.\/([\w.-]+\.js)'/g)].map((m) => m[1]!)
  assert.ok(specs.length > 0, 'app.js 应当有本地模块 import')
  for (const spec of specs) {
    assert.ok(existsSync(new URL(spec, `file://${WEB}`)), `缺少模块：web/${spec}`)
  }
})

test('index.html 引用的入口脚本存在，且带启动兜底', () => {
  const html = read('index.html')
  assert.match(html, /<script type="module" src="app\.js"/, '缺少入口模块')
  assert.ok(existsSync(new URL('app.js', `file://${WEB}`)))
  // JS 未执行/加载失败时也必须能显示状态与失败提示
  assert.match(html, /id="bootStatus"/)
  assert.match(html, /__bbBootDone/)
  assert.match(html, /前端资源加载失败|前端脚本未能启动/, '缺少模块加载失败的兜底提示')
  assert.match(html, /id="bootSkeleton"|class="boot-skeleton"/, '缺少静态启动骨架')
})

test('页面引用的样式与图标文件存在', () => {
  for (const name of ['style.css', 'icons.js', 'theme.js', 'tooltip.js', 'pins.js', 'timeline-math.js']) {
    assert.ok(existsSync(new URL(name, `file://${WEB}`)), `缺少 web/${name}`)
  }
  const html = read('index.html')
  assert.match(html, /href="style\.css"/)
})

test('总览/对比页面引用的脚本存在', () => {
  const pages: Array<[string, string]> = [
    ['overview.html', 'overview.js'],
    ['compare.html', 'compare.js'],
  ]
  for (const [page, script] of pages) {
    const html = read(page)
    assert.match(html, new RegExp(`src="${script.replace('.', '\\.')}"`), `${page} 未引用 ${script}`)
    assert.ok(existsSync(new URL(script, `file://${WEB}`)), `缺少 web/${script}`)
  }
})
