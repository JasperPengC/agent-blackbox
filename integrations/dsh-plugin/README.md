# dsh-agent-blackbox · DSH 插件

把 [agent-blackbox](../../README.md) 的仪表盘装进 DeepSeek Harness 侧栏：
**点一下就在应用内看实时会话 / 回放 / 多会话成本总览，不额外起进程、不额外开端口。**

## 安装（link 方式）

```bash
# 在 agent-blackbox 仓库根目录
npm run plugin:install          # = bash scripts/install-plugin.sh

# 然后重启 DSH（Cmd+Q 后重新打开）
# 左侧栏出现「黑匣子」▣ → 点开即用
```

脚本做三件事（幂等，带备份）：

1. `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 加 `"dsh-agent-blackbox": "link:<本目录>"`；
2. `dsh.profile.bundles` 里启用这个 bundle；
3. `~/.dsh/profiles/desktop/node_modules/dsh-agent-blackbox` 建相对符号链接。

## 卸载

```bash
npm run plugin:uninstall
```

## 入口

| 入口 | 说明 |
|---|---|
| 侧栏「黑匣子」▣ | 主区整屏面板（iframe 以 `?embed=1` 进入嵌入模式：隐藏自身顶栏，避免与外层 chrome 重复） |
| 面板内「新窗口打开」 | 双屏/多显示器场景用它 |
| `http://127.0.0.1:<dsh-port>/blackbox/` | 浏览器直接访问也行 |

面板默认打开**最近活动**的会话；多会话总览页点一行会切到那个会话（`?file=`）。

## 为什么必须 link 安装

宿主半边用 TypeScript 直接引用核心（`../../../src/server.ts`），而
**Node 的类型擦除不作用于 `node_modules` 内的文件**。`link:` 安装会把包解析成
真实路径（落在 `node_modules` 之外），所以能直接跑 TS —— 零构建。

发布到 npm 时文件会落在 `node_modules` 里，那时需要先把核心打包成 JS。
这是已知限制，不是设计偏好。

## 架构上的两个取舍

1. **插件不是第二套实现**：宿主半边只做一件事 —— 把核心的 `createRouter()`
   挂到 DSH 自己 webServer 的 `/blackbox` 前缀下。独立运行的 `blackbox ui`
   与插件面板跑的是同一份路由、同一份投影、同一份渲染器，不会慢慢漂移。
2. **面板用 iframe 而不是用 React 重写**：仪表盘的性能关键（投影、检查点、
   聚合、分桶）全在服务端，前端只是渲染器；iframe 直接复用，代价是一层文档上下文。
   嵌入模式下会隐藏仪表盘自己的顶栏，并把「总览 / 对比 / 新窗口」收进右下角悬浮条。

## 排障

重启后没有入口时依次检查：

```bash
# 1. 依赖与 bundles 是否写进去了
python3 -c "import json;d=json.load(open('$HOME/.dsh/profiles/desktop/package.json'));print(d['dependencies'].get('dsh-agent-blackbox'));print('dsh-agent-blackbox' in d['dsh']['profile']['bundles'])"

# 2. 符号链接是否指向本目录
readlink -f ~/.dsh/profiles/desktop/node_modules/dsh-agent-blackbox

# 3. 宿主日志
ls -t ~/.dsh/profiles/desktop/.plugin-manager/logs/ | head
```

启动失败时可用备份回滚（安装脚本会打印具体路径），或直接 `npm run plugin:uninstall`。
