/**
 * 插件主区面板渲染冒烟
 * ====================
 * 面板是 iframe + 父层占位/重试。这段代码一旦渲染抛错，DSH 面板就会**整块空白**
 * （比 iframe 空白更难查）。这里用一个极简 hooks 运行时把组件跑一遍，
 * 验证：能渲染、占位文案在、失败态能出现重试按钮。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../integrations/dsh-plugin/lib/client.js', import.meta.url))

type El = { type: unknown; props: Record<string, unknown> }

function miniReact() {
  let hooks: unknown[] = []
  let index = 0
  const effects: Array<() => void> = []
  const effectHooks = new Set<number>()
  const React = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El {
      return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } }
    },
    useState<T>(init: T): [T, (v: T | ((p: T) => T)) => void] {
      const i = index++
      if (!(i in hooks)) hooks[i] = init
      return [
        hooks[i] as T,
        (v) => {
          hooks[i] = typeof v === 'function' ? (v as (p: T) => T)(hooks[i] as T) : v
        },
      ]
    },
    useRef<T>(init: T): { current: T } {
      const i = index++
      if (!(i in hooks)) hooks[i] = { current: init }
      return hooks[i] as { current: T }
    },
    useCallback<T>(fn: T): T {
      index++
      return fn
    },
    useEffect(fn: () => void | (() => void)): void {
      const i = index++
      if (effectHooks.has(i)) return
      effectHooks.add(i)
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
  }
  return {
    React,
    render<T>(component: () => T): T {
      index = 0
      return component()
    },
    reset() {
      hooks = []
      index = 0
      effectHooks.clear()
    },
    cleanup() {
      for (const fn of effects.splice(0)) fn()
    },
  }
}

function loadModule() {
  const source = readFileSync(CLIENT, 'utf8')
  const mini = miniReact()
  let exported: { apply: (ctx: unknown) => void } | undefined
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def: { factory: (req: (id: string) => unknown) => { apply: (ctx: unknown) => void } }) {
          exported = def.factory((id: string) => (id === 'react' ? mini.React : {}))
        },
      },
    },
    console,
    // 组件里的轮询/重试用到定时器（vm 上下文默认没有）；测试里手动触发
    setInterval: (fn: () => void) => {
      timers.push(fn)
      return timers.length
    },
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    Date: class extends Date {
      static override now(): number {
        return clock.now
      }
    },
  }
  const timers: Array<() => void> = []
  const clock = { now: 0 }
  runInNewContext(source, sandbox)
  assert.ok(exported, 'client.js 应当注册模块')
  let Dashboard: (() => El) | undefined
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: () => () => {}, bind: () => () => '黑匣子' },
    slots: {
      inject: (_name: string, fn: () => unknown) => fn(),
      register: (def: { name: string }, component: () => El) => {
        if (def.name === 'main') Dashboard = component
        return { component }
      },
    },
  }
  exported!.apply(ctx)
  assert.ok(Dashboard, '应当注册 main 面板组件')
  return {
    Dashboard: Dashboard!,
    mini,
    timers,
    clock,
    exported: exported as unknown as { __isOurDocument: (doc: unknown) => boolean },
  }
}

function findEl(el: unknown, type: string): El | undefined {
  if (el === null || el === undefined || typeof el !== 'object') return undefined
  const node = el as El
  if (node.type === type) return node
  const kids = node.props?.children
  const list = Array.isArray(kids) ? kids : [kids]
  for (const child of list) {
    const hit = findEl(child, type)
    if (hit) return hit
  }
  return undefined
}

function textOf(el: unknown): string {
  if (el === null || el === undefined || typeof el === 'boolean') return ''
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  const node = el as El
  const kids = node.props?.children
  const list = Array.isArray(kids) ? kids : [kids]
  return list.map(textOf).join(' ')
}

test('主区面板：能渲染且显示加载占位', () => {
  const { Dashboard, mini } = loadModule()
  mini.reset()
  let tree: El
  try {
    tree = Dashboard()
  } finally {
    mini.cleanup()
  }
  const text = textOf(tree)
  assert.match(text, /正在加载黑匣子面板|面板服务还没就绪|面板加载失败/)
  // 面板不再自带顶部工具条（DSH 已有 chrome），但 iframe 必须存在且带标题
  const iframe = findEl(tree, 'iframe')
  assert.ok(iframe, '应当渲染 iframe')
  assert.equal(iframe!.props.title, 'agent-blackbox')
})

test('主区面板：iframe 使用嵌入模式并带重试参数', () => {
  const { Dashboard, mini } = loadModule()
  mini.reset()
  let tree: El
  try {
    tree = Dashboard()
  } finally {
    mini.cleanup()
  }
  const json = JSON.stringify(tree)
  assert.match(json, /\/blackbox\/\?embed=1&r=/)
  assert.match(json, /"position":"absolute"/)
})

test('iframe 判定：标题被 app.js 改过也要认得（防反复重载闪烁）', () => {
  const { exported } = loadModule()
  const isOurs = exported.__isOurDocument
  // 静态 HTML 的 title
  assert.equal(isOurs({ title: 'agent-blackbox' }), true)
  // app.js 启动后：<会话名> · agent-blackbox（之前这里全等匹配失败 → iframe 反复重载）
  assert.equal(isOurs({ title: '智能体黑匣子 · agent-blackbox' }), true)
  assert.equal(isOurs({ title: '把 payments 服务的重试逻辑改成分级退避 · agent-blackbox' }), true)
  // 只有关键元素也算
  assert.equal(isOurs({ title: '', querySelector: (sel: string) => (sel === '#sessionTitle' ? {} : null) }), true)
  // Chrome 错误页 / 空白页
  assert.equal(isOurs({ title: '127.0.0.1' }), false)
  assert.equal(isOurs({ title: '' }), false)
  assert.equal(isOurs(null), false)
})

test('端到端：页面已加载（标题带后缀）时不重载 iframe —— 修复闪烁', () => {
  const { Dashboard, mini, timers, clock } = loadModule()
  mini.reset()
  let tree = mini.render(Dashboard)
  const iframe = findEl(tree, 'iframe')
  assert.ok(iframe, '应当渲染 iframe')
  const ref = iframe!.props.ref as { current: unknown }
  // app.js 启动后的真实标题（旧代码用全等匹配会失败 → 反复重载）
  ref.current = { contentDocument: { title: '智能体黑匣子 · agent-blackbox', readyState: 'complete' } }
  clock.now = 5000
  for (const tick of timers) tick()
  tree = mini.render(Dashboard)
  const json = JSON.stringify(tree)
  assert.match(json, /\/blackbox\/\?embed=1&r=0/, '不应重载（r 参数保持 0）')
  assert.doesNotMatch(json, /正在加载黑匣子面板|正在重试/, '就绪后占位应消失')
})

test('端到端：错误页（空标题）才触发重载', () => {
  const { Dashboard, mini, timers, clock } = loadModule()
  mini.reset()
  let tree = mini.render(Dashboard)
  const iframe = findEl(tree, 'iframe')
  assert.ok(iframe, '应当渲染 iframe')
  const ref = iframe!.props.ref as { current: unknown }
  ref.current = { contentDocument: { title: '', readyState: 'complete' } }
  clock.now = 5000
  for (const tick of timers) tick()
  tree = mini.render(Dashboard)
  assert.match(JSON.stringify(tree), /\/blackbox\/\?embed=1&r=1/, '错误页应触发一次重载')
})
