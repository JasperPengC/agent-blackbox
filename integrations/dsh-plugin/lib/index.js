/**
 * agent-blackbox · DSH 插件（宿主半边）
 * ====================================
 *
 * 做一件事：把核心的路由挂到 DSH **自己的** webServer 的 `/blackbox` 前缀下。
 *
 * 关键取舍：
 *   · **不额外起进程、不额外开端口** —— 路由跑在宿主进程里，dashboard 与 API
 *     和 DSH 同源，iframe 直接可用，也没有跨域问题；
 *   · **复用核心路由**（`createRouter`）—— 插件不是第二套实现，就是同一份代码
 *     换了个挂载点；独立运行的 `blackbox ui` 与插件面板行为完全一致；
 *   · 会话来源自动发现：默认打开最近活动的那一个，也可以用 `?file=` 指定。
 *
 * 注意：本文件用 TypeScript 引用核心（`../../../src/*.ts`）。
 * Node ≥22.19 的类型擦除**不作用于 node_modules**，所以本插件必须用
 * `dsh plugin add link:<路径>` 安装（符号链接会被解析成真实路径，落在 node_modules
 * 之外）。发布到 npm 前需要先把核心打成 JS —— 见 README 的「已知限制」。
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 优先加载**构建产物** `dist/`，没有再退回 `src/` 的 TS。
 *
 * 这样插件在两种形态下都能用：
 *   · 仓库里 link 安装（开发）：没有 dist 时直接跑 TS
 *   · 发布包：跑编译后的 JS（npm 安装不会对 node_modules 里的 .ts 做类型擦除）
 */
const ROOT = new URL('../../../', import.meta.url)

/**
 * 选择加载 dist 还是 src：
 *   · 发布包：只有 dist 能跑（Node 不对 node_modules 里的 .ts 做类型擦除）；
 *   · 仓库 link 安装：改了 src 却没 build 时，**dist 是旧的** ——
 *     静默用旧代码是最难查的坑，所以按"哪边更新"决定。
 */
function latestMtime(url) {
  let max = 0
  const walk = (u) => {
    let entries
    try {
      entries = readdirSync(fileURLToPath(u), { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const child = new URL(`${ent.name}${ent.isDirectory() ? '/' : ''}`, u)
      if (ent.isDirectory()) walk(child)
      else {
        try {
          max = Math.max(max, statSync(fileURLToPath(child)).mtimeMs)
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(url)
  return max
}

async function loadCore(name) {
  const dist = new URL(`dist/${name}.js`, ROOT)
  const src = new URL(`src/${name}.ts`, ROOT)
  const distFile = fileURLToPath(dist)
  let target = src
  if (existsSync(distFile)) {
    const distMtime = statSync(distFile).mtimeMs
    const srcMtime = existsSync(fileURLToPath(src)) ? latestMtime(new URL('src/', ROOT)) : 0
    target = distMtime >= srcMtime ? dist : src
  }
  return import(target.href)
}

const { createRouter } = await loadCore('server')
const { discoverAll } = await loadCore('sources')

/** Cordis 插件名（必须与 cordis.patch.yml 里的 insert.id 一致） */
export const name = 'agent-blackbox'

const PREFIX = '/blackbox'
const FALLBACK_FIXTURE = fileURLToPath(new URL('../../../fixtures/mission-demo.ndjson', import.meta.url))

/** 默认打开哪个会话：最近活动的那个；一个都没有就用内置示例 */
function pickDefaultSession(configured) {
  if (typeof configured === 'string' && configured !== '' && existsSync(configured)) return configured
  try {
    const all = discoverAll()
    if (all.length > 0) return all[0].file
  } catch {
    /* 没有安装任何 agent 也能用内置示例 */
  }
  return FALLBACK_FIXTURE
}

export function apply(ctx, config = {}) {
  const file = pickDefaultSession(config.file)
  // follow: true —— 实时会话文件在增长时增量扩展索引；静止会话没有额外开销
const router = createRouter({ file, basePath: PREFIX, follow: true })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: PREFIX,
          handler: (req, res) => {
            try {
              router.handle(req, res)
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
              res.end(`agent-blackbox: ${message}`)
            }
          },
        }),
      `agent-blackbox: ${PREFIX} routes`,
    )
  })
}
