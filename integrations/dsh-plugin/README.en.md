# dsh-agent-blackbox · DSH plugin

[![npm](https://img.shields.io/npm/v/dsh-agent-blackbox?label=npm&color=4f7cff)](https://www.npmjs.com/package/dsh-agent-blackbox)

Puts the [agent-blackbox](https://github.com/JasperPengC/agent-blackbox) dashboard
inside DeepSeek Harness: a sidebar entry and a full-size panel with live session
monitoring, replay and a cross-session cost overview. No extra process, no extra
port.

## Install (npm, recommended)

```bash
dsh plugin --profile desktop add dsh-agent-blackbox
```

Restart DSH, then open *Blackbox* from the sidebar. You can also install it from
*Plugins → Add plugin* by entering the package name, then refresh the page.

## Install from a checkout (development)

```bash
# from the agent-blackbox repository root
npm run plugin:install
npm run plugin:uninstall
```

The script links this directory into the DSH profile and enables the bundle.

## What you get

- **Live**: sessions that are still being written refresh incrementally
- **Replay**: timeline zoom and brush, tool waterfall, event inspector; events and
  tools are revealed as playback advances
- **Attribution**: per-agent tools, tokens, cost and blocking relationships
- **Overview**: cost ranking across sessions, grouped by runtime and project

## How it works

The plugin mounts the core HTTP router under the host's own web server at
`/blackbox`, so the panel is same-origin with DSH and needs no extra port. The
published package bundles the compiled core (`core/`) and renderer (`web/`), so
`dsh plugin add` is enough — a separate agent-blackbox install is not required.

Everything is local: the plugin only reads local session files and makes no
network requests.

## Requirements

- DeepSeek Harness `>=0.2.0-rc.2 <0.3.0`
- Node.js `>=22.19`

## Known limitations

- Sessions larger than 24 MB are loaded from an 8 MB tail window
- Cost estimates need a local pricing file; models without a price are excluded
- Restart DSH after upgrading the plugin

## Links

- Main repository and full documentation: https://github.com/JasperPengC/agent-blackbox
- Issues: https://github.com/JasperPengC/agent-blackbox/issues
