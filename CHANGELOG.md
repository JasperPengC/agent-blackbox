# 变更日志

本项目的重要变更都记录在这里。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

[English](CHANGELOG.en.md) · 中文

## [Unreleased]

### Fixed

- Event list stayed empty after opening or switching a session until a tab was
  clicked: the virtual list kept a stale `data-total` from the previous session
  while the empty state had replaced its inner container.
- Switching sessions reset "follow latest" to off; it now follows the newest
  position again by default.
- Focus-mode playback near the end of a session showed `跳过 Infinity:NaN:NaN`.

## [0.1.0] - 2026-10-25

首个公开版本。

### 新增

- 事件溯源式会话模型：16 种事件、带检查点的索引，seek 耗时与会话事件总数无关。
- 适配器：DeepSeek Harness（`.zstd`）、Claude Code、Codex、ACP 与录制 NDJSON；
  从各 runtime 的标准本地目录自动发现会话。
- 回放仪表盘：时间轴缩放/框选、0.25×–8× 播放、焦点跟随（跳过空闲并追踪当前工具/
  事件/agent）、工具瀑布、带搜索与类型筛选的事件检查器。
- 多会话总览：成本排行、按 runtime/项目分组、token 与工具统计；两个会话对比，
  展示指标差值与工具构成。
- 多 agent 时间线：DSH 子 agent 会话合并进父时间线，拥有独立 lane、工具与 token 统计。
- DSH 插件：侧栏入口与主区整屏面板，复用与独立 UI 相同的 API 与渲染器。
- 深色 / 浅色 / 自动主题；键盘优先操作；一次性首访引导与快捷键面板。
- 事件解码与首屏快照的磁盘缓存；大会话使用 worker 线程解码。
- CLI：`record`、`ingest`、`ui`、`overview`、`sessions`、`live`、`stats`、`replay`、
  `demo`、`adapters`、`cache`。
- 测试覆盖投影器、适配器、缓存、插件宿主与客户端；CI 运行测试、类型检查、
  WCAG 2.1 AA 对比度审计与发布包冒烟。

### 已知限制

- 暂不支持 OpenCode / Pi 会话格式。
- 超过 24 MB 的会话只加载尾部 8 MB 窗口；窗口之外的子 agent 目录不会合并。
- Claude Code 的 sidechain 事件暂未聚合为独立 agent lane。
- 成本估算依赖本地价格表；未知模型不计入成本合计，并在界面中标注。
