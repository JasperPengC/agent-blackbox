# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[中文](CHANGELOG.md) · English

## [0.1.0] - 2026-10-25

First public release.

### Added

- Event-sourced session model with 16 event kinds, checkpointed indexing and
  seek that is independent of session size.
- Adapters for DeepSeek Harness (`.zstd`), Claude Code, Codex, ACP and recorded
  NDJSON; adapters are discovered from their standard local directories.
- Replay dashboard: timeline with zoom/brush, playback from 0.25× to 8×,
  focus-follow mode that skips idle gaps and tracks the active tool, event and
  agent, tool waterfall and an event inspector with search and per-kind filters.
- Session overview with cost ranking, runtime/project grouping, token and tool
  statistics, and a two-session compare view with metric deltas.
- Multi-agent timelines: DSH subagent sessions are merged into the parent
  timeline with per-agent lanes, tools and token accounting.
- DSH plugin: sidebar entry and full-panel view, reusing the same API and
  renderers as the standalone UI.
- Dark, light and auto themes; keyboard-first navigation; one-time onboarding
  and a shortcut reference panel.
- Disk caches for decoded events and first-paint snapshots, plus a worker-based
  decoder for large sessions.
- CLI: `record`, `ingest`, `ui`, `overview`, `sessions`, `live`, `stats`,
  `replay`, `demo`, `adapters` and `cache`.
- Tests for the projector, adapters, caches, plugin host and client, plus CI
  running tests, type checking, a WCAG 2.1 AA contrast audit and a package smoke
  test.

### Known limitations

- OpenCode and Pi session formats are not supported yet.
- Sessions larger than 24 MB are loaded from an 8 MB tail window; subagent
  catalog entries outside that window are not merged.
- Claude Code sidechain events are not aggregated into separate agent lanes.
- Cost estimates require a local pricing file; unknown models are excluded from
  cost totals and flagged in the UI.
