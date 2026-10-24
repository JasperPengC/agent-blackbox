#!/usr/bin/env bash
# 卸载 agent-blackbox DSH 插件（幂等）
set -euo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE"
PKG_NAME="dsh-agent-blackbox"
PKG_JSON="$PROFILE_DIR/package.json"
MODULES="$PROFILE_DIR/node_modules"

[ -f "$PKG_JSON" ] || { echo "✖ 找不到 $PKG_JSON" >&2; exit 1; }
cp "$PKG_JSON" "$PKG_JSON.bak-$(date +%Y%m%d-%H%M%S)"

PKG_JSON="$PKG_JSON" PKG_NAME="$PKG_NAME" python3 - <<'PY'
import json, os
p = os.environ['PKG_JSON']; name = os.environ['PKG_NAME']
with open(p, encoding='utf-8') as fh: pkg = json.load(fh)
pkg.get('dependencies', {}).pop(name, None)
profile = pkg.get('dsh', {}).get('profile', {})
if isinstance(profile.get('bundles'), list):
    profile['bundles'] = [b for b in profile['bundles'] if b != name]
with open(p, 'w', encoding='utf-8') as fh:
    json.dump(pkg, fh, ensure_ascii=False, indent=2); fh.write('\n')
print('  · package.json 已清理')
PY

[ -L "$MODULES/$PKG_NAME" ] && rm -f "$MODULES/$PKG_NAME" && echo "  · 符号链接已删除"
echo "✓ 已卸载（重启 DSH 生效）"
