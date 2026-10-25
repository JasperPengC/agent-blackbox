#!/usr/bin/env bash
# Generate the README screenshots from synthetic fixtures only.
# The playback GIFs in docs/ are screen recordings, not generated here.
# Usage: bash scripts/make-assets.sh
# Requires: Chrome (screenshots).
set -euo pipefail

PORT=7900
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
export CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

show() { node scripts/shot.mjs "http://127.0.0.1:$PORT$1" "docs/$2" "${3:-1600}" "${4:-1000}" "${@:5}"; }

echo "▸ starting local server (synthetic fixtures)"
rm -f /tmp/bb-assets-cache.json
DSH_SESSIONS_DIR="$ROOT/fixtures/multi-runtime/dsh" \
CLAUDE_PROJECTS_DIR="$ROOT/fixtures/multi-runtime/claude" \
CODEX_SESSIONS_DIR="$ROOT/fixtures/multi-runtime/codex" \
DSH_TITLES_DIR="$ROOT/fixtures/multi-runtime/titles" \
BLACKBOX_CACHE=/tmp/bb-assets-cache.json \
  node src/cli.ts ui fixtures/mission-demo.ndjson --port "$PORT" >/tmp/bb-assets.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 2

echo "▸ dashboard (dark / light)"
show "/?t=22000&onboard=off" screenshot.png
show "/?t=22000&theme=light&onboard=off" light.png

echo "▸ zoomed timeline"
show "/?t=12000&from=10000&to=16000&onboard=off" zoom.png

echo "▸ shortcuts panel"
show "/?t=22000&onboard=off" help.png 1600 1000 --eval "window.__bb.toggleHelp(true)"

echo "▸ session switcher"
show "/?t=22000&onboard=off" switcher.png 1600 1000 \
  --eval "new Promise((r)=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}));setTimeout(()=>r('ok'),900)})"

echo "▸ onboarding"
show "/?t=22000&theme=light" onboarding.png 1600 1000

echo "▸ loading skeleton (delayed meta request)"
show "/?t=22000&onboard=off" loading.png 1600 1000 --wait 350 \
  --preload "const o=window.fetch;window.fetch=(u,x)=>String(u).includes('api/meta')?new Promise(r=>setTimeout(()=>o(u,x).then(r),1600)):o(u,x)"

echo "▸ overview"
show "/overview?onboard=off&hideEmpty=0" overview.png

echo "▸ compare"
LEFT=$(DSH_SESSIONS_DIR="$ROOT/fixtures/multi-runtime/dsh" node --input-type=module -e "
import { discoverAll } from './src/sources.ts'
const a = discoverAll().filter((s) => s.sessionId.includes('8f2c41aa') || s.sessionId.includes('b31c9d54'))
console.log(encodeURIComponent(a[0].file) + ' ' + encodeURIComponent(a[1].file))")
read -r L R <<< "$LEFT"
show "/compare?left=$L&right=$R" compare.png

echo "▸ narrow panel"
show "/?t=22000&onboard=off&embed=1&theme=light" narrow.png 420 700

echo "▸ embedded / panel size"
show "/?t=22000&embed=1" responsive.png 900 720

ls -la docs/*.png | awk '{print "  ", $5, $9}'
