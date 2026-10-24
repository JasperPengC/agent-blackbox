# Changelog

## [0.1.0] - 2026-10-25

First public release.

### Added

- Sidebar entry and full-size panel for the agent-blackbox dashboard inside
  DeepSeek Harness.
- Live session monitoring, timeline replay, per-agent attribution and the
  cross-session cost overview, all served from the host process.
- Self-contained package: compiled core (`core/`) and renderer (`web/`) are
  bundled, so the plugin works without a separate agent-blackbox install.
- Bundled synthetic fixture used when no local session exists.
