/**
 * DSH 插件测试
 * ============
 * 不去启动 DSH 也能验证两半都是对的：
 *   · 宿主半边：用假 ctx 捕获 webServer 注册，再直接喂假 req/res；
 *   · 浏览器半边：用假 `window.__ModuleLoader__` + 假 react，验证注册内容。
 *
 * 另外钉住前缀路由的两种形态（带前缀 / 已被宿主剥掉前缀都要能用）。
 */

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 插件默认会话与总览都从这几个环境变量取根目录 —— 测试指向合成数据，
// 既不依赖本机真实会话，也不会因为扫 100+ 个会话而变慢。
const FIXTURES = fileURLToPath(new URL('../fixtures/multi-runtime/', import.meta.url))
process.env['DSH_SESSIONS_DIR'] = `${FIXTURES}dsh`
process.env['CLAUDE_PROJECTS_DIR'] = `${FIXTURES}claude`
process.env['CODEX_SESSIONS_DIR'] = `${FIXTURES}codex`
process.env['BLACKBOX_CACHE'] = fileURLToPath(new URL('../.tmp-plugin-cache.json', import.meta.url))

type RouteDef = { kind: string; path: string; handler: (req: unknown, res: unknown) => void }

type FakeRes = {
  status: number
  headersSent: boolean
  body: string
  done: Promise<void>
  writeHead: (code: number, headers?: Record<string, string>) => FakeRes
  setHeader: () => void
  end: (chunk?: unknown) => void
}

function fakeRes(): FakeRes {
  let resolveDone: () => void = () => {}
  const res: FakeRes = {
    status: 0,
    headersSent: false,
    body: '',
    done: new Promise<void>((r) => (resolveDone = r)),
    writeHead(code: number) {
      res.status = code
      res.headersSent = true
      return res
    },
    setHeader() {},
    end(chunk?: unknown) {
      res.body = chunk === undefined ? '' : String(chunk)
      resolveDone()
    },
  }
  return res
}

async function callRoute(route: RouteDef, url: string): Promise<FakeRes> {
  const res = fakeRes()
  route.handler({ url, method: 'GET', headers: {} }, res)
  await Promise.race([res.done, new Promise((r) => setTimeout(r, 1500))])
  return res
}

async function loadHost(): Promise<{ routes: RouteDef[] }> {
  // @ts-expect-error 插件是纯 JS，没有类型声明
  const mod = (await import('../integrations/dsh-plugin/lib/index.js')) as {
    name: string
    apply: (ctx: unknown, config?: unknown) => void
  }
  assert.equal(mod.name, 'agent-blackbox', 'Cordis 插件名必须与 patch 的 insert.id 一致')
  const routes: RouteDef[] = []
  const fakeCtx = {
    inject: (names: string[], cb: (c: unknown) => void) => {
      assert.deepEqual(names, ['webServer'])
      cb({
        effect: (fn: () => unknown) => fn(),
        webServer: {
          register: (def: RouteDef) => {
            routes.push(def)
            return () => {}
          },
        },
      })
    },
  }
  mod.apply(fakeCtx, {})
  return { routes }
}

after(async () => {
  // 总览路由会拉起 worker：测试结束前显式回收，避免进程挂住
  const { disposeOverview } = (await import('../src/overview-async.ts')) as { disposeOverview: () => void }
  disposeOverview()
})

test('插件宿主：注册的是 /blackbox 前缀路由，且只有一个', async () => {
  const { routes } = await loadHost()
  assert.equal(routes.length, 1)
  assert.equal(routes[0]!.kind, 'prefix')
  assert.equal(routes[0]!.path, '/blackbox')
})

test('插件宿主：带前缀与不带前缀都能取到仪表盘', async () => {
  const { routes } = await loadHost()
  const route = routes[0]!

  const withPrefix = await callRoute(route, '/blackbox/')
  assert.equal(withPrefix.status, 200)
  assert.match(withPrefix.body, /<title>agent-blackbox<\/title>/)
  // 资源必须是相对路径，否则挂在 /blackbox/ 下会去请求 /app.js（根路径）
  assert.match(withPrefix.body, /src="app\.js"/)
  assert.match(withPrefix.body, /href="style\.css"/)

  const stripped = await callRoute(route, '/')
  assert.equal(stripped.status, 200)
  assert.match(stripped.body, /agent-blackbox/)
})

test('插件宿主：API 在前缀下可用（含 ?file= 切换会话）', async () => {
  const { routes } = await loadHost()
  const route = routes[0]!
  const meta = await callRoute(route, '/blackbox/api/meta')
  assert.equal(meta.status, 200)
  const parsed = JSON.parse(meta.body) as { run: string; eventCount: number }
  assert.ok(typeof parsed.run === 'string' && parsed.run.length > 0)
  assert.ok(parsed.eventCount >= 0)

  const overview = await callRoute(route, '/blackbox/api/overview')
  assert.equal(overview.status, 200)
  const data = JSON.parse(overview.body) as { rows: unknown[] }
  assert.ok(Array.isArray(data.rows))

  const page = await callRoute(route, '/blackbox/overview')
  assert.equal(page.status, 200)
  assert.match(page.body, /会话总览/)
})

test('插件宿主：/api/sessions 返回会话列表（含标题字段）', async () => {
  const { routes } = await loadHost()
  const route = routes[0]!
  const res = await callRoute(route, '/blackbox/api/sessions')
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body) as { sessions: Array<Record<string, unknown>> }
  assert.ok(Array.isArray(body.sessions))
  assert.ok(body.sessions.length > 0, '至少应发现一个会话')
  const first = body.sessions[0]!
  for (const key of ['file', 'sessionId', 'runtime', 'project', 'mtime']) {
    assert.ok(key in first, `缺少字段 ${key}`)
  }
  // 标题字段可以为 null（DSH 里没有标题的会话），但字段必须存在
  assert.ok('title' in first)
})

test('插件客户端：模块 id 与包名一致，注册侧栏与主区两个面板', async () => {
  const g = globalThis as unknown as {
    window?: { __ModuleLoader__?: { load: (def: unknown) => void } }
  }
  let loaded: { id: string; factory: (req: (m: string) => unknown) => unknown } | undefined
  g.window = {
    __ModuleLoader__: {
      load: (def: unknown) => {
        loaded = def as typeof loaded
      },
    },
  }
  // @ts-expect-error 插件是纯 JS，没有类型声明
  await import('../integrations/dsh-plugin/lib/client.js')
  assert.ok(loaded, 'client.js 必须通过 __ModuleLoader__.load 注册')
  assert.equal(loaded!.id, 'dsh-agent-blackbox', '模块 id 必须等于包名')

  const reactStub = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (initial: unknown) => [initial, () => {}],
  }
  const client = loaded!.factory((name: string) => {
    if (name === 'react') return reactStub
    throw new Error(`unexpected module: ${name}`)
  }) as { name: string; inject: string[]; apply: (ctx: unknown) => void }
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(client.inject, ['slots', 'locale'])

  const registered: Array<{ slot: string; def: { id?: string; key?: string; label?: () => string } }> = []
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: {
      register: () => () => {},
      bind: () => () => '黑匣子',
    },
    slots: {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (def: { id?: string; key?: string; label?: () => string }, _component: unknown) => {
        registered.push({ slot: def.id !== undefined ? 'sidebar.panellist' : 'main', def })
        return () => {}
      },
    },
  }
  client.apply(ctx)

  assert.equal(registered.length, 2)
  const main = registered.find((r) => r.slot === 'main')
  const sidebar = registered.find((r) => r.slot === 'sidebar.panellist')
  assert.ok(main, '必须注册主区面板')
  assert.ok(sidebar, '必须注册侧栏入口')
  assert.equal(sidebar!.def.id, 'agent-blackbox')
  assert.equal(typeof sidebar!.def.label, 'function')
  assert.equal(sidebar!.def.label!(), '黑匣子')
})

test('插件清单：dsh 字段声明了 bundle patch 与 web 客户端', () => {
  const pkgPath = fileURLToPath(new URL('../integrations/dsh-plugin/package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    name: string
    dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
  }
  assert.equal(pkg.name, 'dsh-agent-blackbox')
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh?.client?.platform, 'web')

  const patchPath = fileURLToPath(new URL('../integrations/dsh-plugin/cordis.patch.yml', import.meta.url))
  const patch = readFileSync(patchPath, 'utf8')
  assert.match(patch, /id: agent-blackbox/)
  assert.match(patch, /name: 'dsh-agent-blackbox'/)
})
