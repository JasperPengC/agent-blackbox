# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest minor | Yes |
| Older versions | Reports accepted; fixes not guaranteed |

## Reporting a vulnerability

Use GitHub's **private security advisory** for this repository instead of a public
issue. If advisories are unavailable to you, open an issue that only says you want
to report a security problem privately; do not include details.

## Data this tool touches

**Reads**

- Local session logs: `~/.dsh/sessions/**`, `~/.claude/projects/**`, `~/.codex/sessions/**`
- Local state: `~/.dsh/blackbox/` (statistics cache, pricing file)

**Never does**

- Makes network requests (no telemetry, no sync, no third-party reporting)
- Modifies session logs (read-only access)
- Intercepts or proxies LLM calls

## Deployment notes

1. The server binds to `127.0.0.1` by default and has **no authentication**. Binding
   to `0.0.0.0` or exposing the plugin route to a LAN lets anyone who can reach the
   port read your sessions. Do not expose it to the internet.
2. The `?file=` parameter only accepts files inside known session directories or the
   current working directory. This prevents arbitrary file reads but is not a trust
   boundary: anyone who can reach the port can already see those directories.
3. Check recordings and screenshots before sharing them. Session logs can contain
   keys, internal hostnames and source snippets.

## Prompt injection

Event content (agent output, tool results) is rendered as text only. It is never
evaluated and never interpolated as HTML; all dynamic text goes through an escape
function. If a future feature feeds blackbox output back into an agent, that input
must be treated as untrusted.

## Known risks

- A session log contains the full conversation and tool output; sharing the file
  shares that content.
- The plugin route is mounted on the host application's web server and inherits its
  network exposure policy.
- `pricing.json` and cache files live under `~/.dsh/blackbox/` with permissions
  determined by the system umask.
