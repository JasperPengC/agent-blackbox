# dsh-agent-blackbox · DSH 插件

[![npm](https://img.shields.io/npm/v/dsh-agent-blackbox?label=npm&color=4f7cff)](https://www.npmjs.com/package/dsh-agent-blackbox)

把 [agent-blackbox](https://github.com/JasperPengC/agent-blackbox) 的仪表盘装进
DeepSeek Harness 侧栏：**点一下就在应用内看实时会话 / 回放 / 多会话成本总览，
不额外起进程、不额外开端口。**

## 安装（npm，推荐）

```bash
dsh plugin --profile desktop add dsh-agent-blackbox
```

然后在 DSH 里重启（Cmd+Q 后重新打开），左侧栏出现「黑匣子」▣ → 点开即用。
也可以在 DSH 的「插件 → 添加插件」里填写包名安装，装完刷新一次页面。

## 安装（link，仓库开发用）

```bash
# 在 agent-blackbox 仓库根目录
npm run plugin:install     # 幂等，会先备份 profile
```

脚本会把本目录以 `link:` 方式挂进 DSH profile，并启用对应的 bundle。
卸载：`npm run plugin:uninstall`。

## 入口

| 入口 | 说明 |
|---|---|
| 侧栏「黑匣子」▣ | 主区整屏面板（iframe 以 `?embed=1` 进入嵌入模式，隐藏自身顶栏） |
| 面板内「新窗口打开」 | 双屏 / 多显示器场景 |
| `http://127.0.0.1:<dsh-port>/blackbox/` | 浏览器直接访问也行，和独立 `blackbox ui` 同源同行为 |

面板默认打开**最近活动**的会话；总览页点一行会切到对应会话（`?file=`）。

## 能看什么

- **实时**：正在写入的会话自动增量刷新（LIVE 指示灯，事件/时钟随会话推进）
- **回放**：时间轴缩放/框选、工具瀑布、事件检查器；事件与工具随播放逐步揭示
- **归因**：每个 agent 的工具、token、成本；阻塞关系
- **总览**：跨会话成本排行，按 runtime / 项目分组

## 工作原理

插件把核心的 HTTP 路由挂到 DSH **自己的** webServer 的 `/blackbox` 前缀下，
和 DSH 同源，没有额外端口；发布包里已经内置编译后的核心（`core/`）与前端
（`web/`），所以 `dsh plugin add` 装完即可用，不需要在机器上另装 agent-blackbox。

所有数据都在本机：插件只读本地会话文件，无网络请求、无遥测。

## 要求

- DeepSeek Harness `>=0.2.0-rc.2 <0.3.0`
- Node.js `>=22.19`

## 已知限制

- 超过 24 MB 的会话只加载尾部 8 MB 窗口（大会话的早期工具不会出现在回放里）
- 成本估算依赖本地价格表 `~/.dsh/blackbox/pricing.json`；未知模型不计入合计
- 升级插件后需要重启 DSH（宿主代码在启动时加载）；只改前端时可刷新面板

## 链接

- 主仓库与完整文档：https://github.com/JasperPengC/agent-blackbox
- 问题反馈：https://github.com/JasperPengC/agent-blackbox/issues
