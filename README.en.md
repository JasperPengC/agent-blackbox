# agent-blackbox

[中文](README.md) · English

Flight recorder for AI coding agents: reads the session logs that runtimes already
write locally and rebuilds them into a replayable, inspectable, comparable event
timeline. Everything runs on your machine — no network requests, no telemetry.

[![CI](https://github.com/JasperPengC/agent-blackbox/actions/workflows/ci.yml/badge.svg)](https://github.com/JasperPengC/agent-blackbox/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933)
![runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-blue)

![Panel replay: timeline, tool waterfall and event inspector](docs/playback-dark.gif)

<sub>Dark theme · 4× playback · synthetic session · [light recording](docs/playback-light.gif) · slow connection? [open the static screenshot](docs/light.png)</sub>

## Features

**Replay**
- Timeline zoom, brush selection, 0.25×–8× playback; focus-follow skips idle gaps
  and tracks the current tool, event and agent
- Tool waterfall (sized by duration) and event inspector (search, kind filters,
  full payload)
- Events and tools are revealed as playback advances instead of filling the whole
  window at once

**Analysis**
- Session overview: events, duration, tool success rate, tokens, cost ranking
- Two-session compare: metric deltas, tool mix, slowest calls
- Multi-agent: DSH subagent sessions are merged into the parent timeline with
  their own lanes and token attribution

**Product details**
- Multiple runtimes, dark/light themes, keyboard-first, WCAG 2.1 AA contrast audit
- Zero runtime dependencies (Node built-ins only)

![Session overview with cost ranking](docs/overview.png)
![Compare two sessions](docs/compare.png)

## Supported runtimes

| Runtime | Source | Status |
| --- | --- | --- |
| DeepSeek Harness (DSH) | `~/.dsh/sessions/` (`.zstd`) | stable |
| Claude Code | `~/.claude/projects/` (`.jsonl`) | stable |
| Codex | `~/.codex/sessions/` (`.jsonl`) | stable |
| ACP | agent-client-protocol logs | experimental |
| Recorded NDJSON | `blackbox record` output | stable |

## Quick start

Requires Node.js ≥ 22.19. Sources run through Node's type stripping; no build step.

```bash
git clone https://github.com/JasperPengC/agent-blackbox.git
cd agent-blackbox
npm install

npm run demo:ui              # synthetic demo in the browser
npm run demo                 # synthetic demo in the terminal
node src/cli.ts sessions     # list discovered sessions
node src/cli.ts ui <file>    # open a session
node src/cli.ts live         # follow the newest session
node src/cli.ts overview     # terminal cost ranking
```

## DSH plugin

[![npm](https://img.shields.io/npm/v/dsh-agent-blackbox?label=npm&color=4f7cff)](https://www.npmjs.com/package/dsh-agent-blackbox)

```bash
dsh plugin --profile desktop add dsh-agent-blackbox
```

After restarting DSH, *Blackbox* appears in the sidebar and as a full panel. It can
also be installed from *Settings → Plugin market* by searching `agent-blackbox`.
The plugin is developed and released from
[dsh-agent-blackbox](https://github.com/JasperPengC/dsh-agent-blackbox).

## How it works

- **Event sourcing**: state at any time is a fold over the prefix of events;
  checkpoints make seeking independent of the event count
- **Adapters**: DSH / Claude Code / Codex / ACP / NDJSON → one event model (16 kinds)
- **Indexing**: decode once, checkpoint at intervals, cache on disk; HTTP API plus
  a plain-JS renderer

## Performance

Intel Mac (Core i7-10700 @ 2.90 GHz, macOS 14.8.9), Node 24.18, Chrome 155, measured
against synthetic fixtures and a 47 MB session. Expect faster numbers on Apple silicon.

| Metric | Value |
| --- | --- |
| First contentful paint | 104–108 ms |
| First data (warm cache) | 225–315 ms |
| First data (cold, 47 MB session) | 2.0–2.4 s |
| Frame time during replay | 17 ms median / 17 ms p95 |
| Index build, 100k events | 129–132 ms |
| Seek (checkpoints enabled) | 80 µs median, 145 µs p95, 323 µs max |
| Seek from scratch | 20.6–21.8 ms |

`npm run bench` reproduces the index/seek numbers; `npm run perf` measures first paint.

## Data and privacy

- Reads session files in read-only mode
- No network calls, no telemetry, no accounts
- Caches and pricing live under `~/.dsh/blackbox/`; `blackbox cache --clear` clears them
- Cost estimates need a local `pricing.json`; models without a price are excluded
  from totals and flagged in the UI

## Limitations

- OpenCode and Pi session formats are not supported yet
- Sessions larger than 24 MB load an 8 MB tail window; subagent catalog entries
  outside that window are not merged
- Claude Code sidechain events are not aggregated into separate agent lanes
- The plugin is tested with DSH; other editors can use the standalone server

## Related repositories

- [dsh-agent-blackbox](https://github.com/JasperPengC/dsh-agent-blackbox) — DSH plugin
  (npm `dsh-agent-blackbox`)

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Security reports: [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
