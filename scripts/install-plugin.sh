#!/usr/bin/env bash
# 把 agent-blackbox 安装成 DSH 插件（link 方式，幂等）
#
# 做三件事：
#   1. profile package.json 的 dependencies 里加 link: 依赖；
#   2. dsh.profile.bundles 里启用这个 bundle；
#   3. node_modules 里建相对符号链接（这样 Node 解析到真实路径，
#      落在 node_modules 之外，TS 类型擦除才生效）。
#
# 每一步都先备份，重复执行不会产生重复条目。
set -euo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/integrations/dsh-plugin"
PKG_NAME="dsh-agent-blackbox"

[ -d "$PROFILE_DIR" ] || { echo "✖ 找不到 profile：$PROFILE_DIR" >&2; exit 1; }
[ -f "$PLUGIN_DIR/package.json" ] || { echo "✖ 找不到插件：$PLUGIN_DIR" >&2; exit 1; }

PKG_JSON="$PROFILE_DIR/package.json"
BACKUP="$PKG_JSON.bak-$(date +%Y%m%d-%H%M%S)"
cp "$PKG_JSON" "$BACKUP"
echo "  · 已备份 $PKG_JSON → $(basename "$BACKUP")"

PLUGIN_DIR="$PLUGIN_DIR" PKG_JSON="$PKG_JSON" PKG_NAME="$PKG_NAME" python3 - <<'PY'
import json, os

pkg_json = os.environ['PKG_JSON']
plugin_dir = os.environ['PLUGIN_DIR']
name = os.environ['PKG_NAME']

with open(pkg_json, encoding='utf-8') as fh:
    pkg = json.load(fh)

deps = pkg.setdefault('dependencies', {})
deps[name] = f'link:{plugin_dir}'
pkg['dependencies'] = dict(sorted(deps.items()))

profile = pkg.setdefault('dsh', {}).setdefault('profile', {})
bundles = profile.setdefault('bundles', [])
if name not in bundles:
    bundles.append(name)
profile['bundles'] = bundles

with open(pkg_json, 'w', encoding='utf-8') as fh:
    json.dump(pkg, fh, ensure_ascii=False, indent=2)
    fh.write('\n')
print('  · package.json：依赖 + bundles 已更新')
PY

MODULES="$PROFILE_DIR/node_modules"
mkdir -p "$MODULES"
# 用相对路径建链，和 dsh 插件管理器自己的做法保持一致
REL="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$PLUGIN_DIR" "$MODULES")"
if [ -L "$MODULES/$PKG_NAME" ]; then
  rm "$MODULES/$PKG_NAME"
elif [ -e "$MODULES/$PKG_NAME" ]; then
  echo "✖ $MODULES/$PKG_NAME 已存在且不是符号链接，拒绝覆盖" >&2
  exit 1
fi
ln -s "$REL" "$MODULES/$PKG_NAME"
echo "  · 符号链接 $MODULES/$PKG_NAME → $REL"

python3 -c "import json,sys; json.load(open(sys.argv[1])); print('  · package.json 校验通过')" "$PKG_JSON"

cat <<EOF

✓ 已安装到 profile「$PROFILE」

  下一步：重启 DSH（Cmd+Q 后重新打开），左侧栏会出现「黑匣子」入口 ▣

  如果不能启动，恢复备份即可：
    cp "$BACKUP" "$PKG_JSON"
    rm -f "$MODULES/$PKG_NAME"
EOF
