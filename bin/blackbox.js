#!/usr/bin/env node
/**
 * agent-blackbox launcher.
 *
 * 两种运行形态：
 *   · 发布包 / `npm i -g` / `npx`：跑编译后的 `dist/cli.js`
 *     （Node 不对 node_modules 里的 .ts 做类型擦除，所以必须有构建产物）
 *   · 仓库内开发：没有 dist 时直接跑 `src/cli.ts`
 *
 * 设置 BLACKBOX_DEV=1 可强制走 src（改代码后不想 build 时用）。
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  console.error(
    `agent-blackbox requires Node >= 22.19, found ${process.versions.node}.\n` +
      'Upgrade Node, or run: npx -y node@22 src/cli.ts <command>',
  )
  process.exit(1)
}

const dist = new URL('../dist/cli.js', import.meta.url)
const src = new URL('../src/cli.ts', import.meta.url)
const preferSrc = process.env.BLACKBOX_DEV === '1'
const entry = preferSrc || !existsSync(dist) ? src : dist

if (entry === src && !existsSync(src)) {
  console.error('找不到入口文件：dist/cli.js 与 src/cli.ts 都不存在（发布包可能不完整）')
  process.exit(1)
}

const mod = await import(pathToFileURL(entry.pathname).href)
if (typeof mod.main !== 'function') {
  console.error('入口文件没有导出 main()（发布包可能不完整）')
  process.exit(1)
}
await mod.main()
