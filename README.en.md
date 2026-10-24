# agent-blackbox

[中文](README.md) · English

A flight recorder for AI coding agents. It turns the session files your agent
runtimes already write into an event-sourced timeline you can watch live, replay,
inspect, and compare across sessions.

Everything stays on your machine: the tool only reads local session files and has
no telemetry.

[![CI](https://github.com/JasperPengC/agent-blackbox/actions/workflows/ci.yml/badge.svg)](https://github.com/JasperPengC/agent-blackbox/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%E2%89%A522.19-339933)
![runtime deps](https://img.shields.io/badge/runtime%20dependencies-0-blue)

![Dashboard: replay with timeline, tool waterfall and event inspector](docs/screenshot.png)

## Why

Agent runs are mostly opaque. A finished session is a flat log file: you cannot
tell where the time went, which tool call stalled, how many tokens an agent
consumed, or how two runs of the same task differ.

agent-blackbox reconstructs that from the event log:

- **state at any point in time** — `state(t) = fold(initialState, events ≤ t)`
- **time-travel replay** — drag the timeline, zoom into a region, watch tools appear
- **per-agent accounting** — tool calls, tokens and cost attributed to each agent
- **cross-session analysis** — duration, tokens, failures and cost side by side

## Features

**Replay**
- Timeline with zoom, brush selection and keyboard scrub
- Playback at 0.25×–8×, with a *focus* mode that skips idle gaps and follows the
  current tool, event and agent across the UI
- Tool waterfall sorted by start time, sized by duration, colored by tool
- Event inspector with search, per-kind filters and full payload view
- Event list and waterfall reveal progressively while replaying

**Analysis**
- Session overview: events, duration, tool success rate, token usage, estimated cost
- Cost ranking across all sessions, grouped by runtime and project
- Compare two sessions: metric deltas, tool mix, slowest calls
- Multi-agent runs: DSH subagent sessions are merged into the parent timeline with
  their own lanes, tokens and tools

**Runtimes**

| Runtime | Source | Status |
| --- | --- | --- |
| DeepSeek Harness (DSH) | `~/.dsh/sessions/` (`.zstd`) | stable |
| Claude Code | `~/.claude/projects/` (`.jsonl`) | stable |
| Codex | `~/.codex/sessions/` (`.jsonl`) | stable |
| ACP | agent-client-protocol logs | experimental |
| Recorded NDJSON | `blackbox record` output | stable |

**Product details**
- Zero runtime dependencies; Node built-ins only
- Automatic dark/light themes (follows the host system or the embedding app)
- Keyboard-first: `/`, `⌘K`, `Space`, `F`, `↑↓`, `?`
- WCAG 2.1 AA contrast audited in CI
- Optional DSH plugin: sidebar entry and full-panel view

![Light theme](docs/light.png)
![Session overview with cost ranking](docs/overview.png)
![Compare two sessions](docs/compare.png)

## Quick start

Requires Node.js ≥ 22.19 (the sources are TypeScript, executed via Node's type
stripping). No build step is needed for local use.

```bash
git clone https://github.com/JasperPengC/agent-blackbox.git
cd agent-blackbox
npm install

# synthetic demo (browser or terminal)
npm run demo:ui                 # opens the browser dashboard
npm run demo                    # terminal replay

# real sessions
node src/cli.ts sessions        # list discovered sessions
node src/cli.ts ui <file>       # open a session in the browser
node src/cli.ts live            # follow the newest session (or pass a session id)
node src/cli.ts overview        # terminal cost ranking across sessions (--json available)
```

In the browser UI, the "sessions" entry in the header opens the multi-session
cost overview.

For npm-style usage, `npm install -g .` installs the `blackbox` binary
(the `dist/` build is prebuilt on publish; `npm run build` builds it locally).

### DSH plugin

[![npm](https://img.shields.io/npm/v/dsh-agent-blackbox?label=npm&color=4f7cff)](https://www.npmjs.com/package/dsh-agent-blackbox)

Install from npm (recommended):

```bash
dsh plugin --profile desktop add dsh-agent-blackbox
```

After restarting DSH, the plugin appears as *Blackbox* in the sidebar and as a
full panel in the main area. It reuses the same HTTP API and renderers as the
standalone UI, and the published package bundles the compiled core, so a separate
agent-blackbox install is not required. The plugin is developed and released from
[dsh-agent-blackbox](https://github.com/JasperPengC/dsh-agent-blackbox).

For development from a checkout:

```bash
npm run plugin:install     # idempotent: links the plugin into the DSH profile
npm run plugin:uninstall
```

## How it works

```
session files ──▶ adapters ──▶ events ──▶ projector ──▶ index / checkpoints
                                                          │
                                              HTTP API (Node, zero deps)
                                                          │
                                        renderers (vanilla JS, canvas + DOM)
```

- **Event sourcing.** A session is an ordered event log; the UI state at time `t`
  is a fold over events up to `t`. Seeking is `O(1)` in the number of events once
  checkpoints are in place.
- **Adapters.** Each runtime has a small adapter that maps its native records to a
  common event schema (16 event kinds: tool calls, messages, checkpoints, usage…).
- **Indexing.** Events are decoded once (in a worker thread when available),
  indexed into checkpoints every N events, and cached on disk. Reopening a large
  session is a cache read.
- **Transport.** A single Node HTTP server exposes JSON endpoints consumed by the
  dashboard, overview, compare view and the plugin. No framework, no bundler.

## Performance

Measured on an **Intel Mac** (Core i7-10700 @ 2.90 GHz, macOS 14.8.9), Node 24.18,
Chrome 155, against synthetic fixtures and a 47 MB real session. Expect faster
numbers on Apple silicon.

| Metric | Value |
| --- | --- |
| First contentful paint | 104–108 ms |
| First data (warm cache) | 225–315 ms |
| First data (cold, 47 MB session) | 2.0–2.4 s |
| Frame time during replay | 17 ms median / 17 ms p95 |
| Index build, 100k events | 129–132 ms |
| Seek into 100k events (checkpoints enabled) | 80 µs median, 145 µs p95, 323 µs max |
| Seek from scratch (no checkpoints) | 20.6–21.8 ms |

`npm run bench` reproduces the index/seek numbers; `npm run perf` measures first
paint against a running server.

## Data and privacy

- Reads session files in read-only mode; never writes to them
- No network calls, no telemetry, no accounts
- Caches live under `~/.dsh/blackbox/` and can be cleared with
  `blackbox cache --clear`
- Pricing for cost estimates is a local JSON file (`~/.dsh/blackbox/pricing.json`);
  models without a price are excluded from cost totals and reported in the UI

## Limitations

- OpenCode and Pi sessions are not supported yet (their formats need samples)
- Sessions larger than 24 MB are loaded from the tail (8 MB window); subagent
  catalog entries in the middle of the file are not merged in that mode
- Claude Code sidechain (subagent) events are not aggregated into separate lanes yet
- Cost estimates depend on the local pricing file; unknown models show no cost
- The plugin is tested with DSH; other editors can use the standalone server

## Contributing

Release history: [CHANGELOG.en.md](CHANGELOG.en.md) ([中文](CHANGELOG.md)).

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
Security reports: see [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
