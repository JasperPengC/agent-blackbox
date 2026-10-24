#!/usr/bin/env bash
# 发布包冒烟：模拟"陌生人从 npm 安装"，验证装完能不能真的跑。
#
# 这个脚本存在的唯一原因：我们曾经以为"零构建"是优点，
# 结果 `npm i -g` 直接崩在 Node 的 node_modules 类型擦除限制上。
# 现在它进 CI，防止再退化。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

echo "▸ 打包（prepare 会自动 build）"
npm pack --silent --pack-destination "$TMP" >/dev/null
TGZ="$(ls "$TMP"/*.tgz | head -1)"
echo "  $(basename "$TGZ")  $(du -h "$TGZ" | cut -f1)"

echo "▸ 装进空项目"
cd "$TMP"
npm init -y >/dev/null 2>&1
npm install --silent --no-audit --no-fund "$TGZ" >/dev/null 2>&1
BIN="$TMP/node_modules/.bin/blackbox"
[ -x "$BIN" ] || { echo "✖ 没有生成 bin：blackbox" >&2; exit 1; }

echo "▸ 冒烟"
"$BIN" --version | sed 's/^/  version  /'
"$BIN" demo --stats --no-color | grep -E "事件|时长" | sed 's/^/  /'
"$BIN" demo --once --no-color >/dev/null && echo "  终端回放 ok"
"$BIN" adapters --json | grep -q '"dsh"' && echo "  adapters ok"

echo "▸ 启动一次本地服务并请求 API"
# 注意：必须切到**安装目录**再跑，否则相对路径的 fixtures 找不到；
# 并且每一步都要显式失败 —— `curl && echo` 在 set -e 下不会中断，会静默变绿。
cd "$TMP/node_modules/agent-blackbox"
"$BIN" ui fixtures/mission-demo.ndjson --port 7911 >/tmp/verify-pack.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; cleanup' EXIT
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:7911/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.3
done
curl -sf "http://127.0.0.1:7911/api/health" >/dev/null || { echo "✖ /api/health 不可用" >&2; cat /tmp/verify-pack.log >&2; exit 1; }
echo "  /api/health ok"
curl -sf "http://127.0.0.1:7911/api/meta" | grep -q '"run"' || { echo "✖ /api/meta 异常" >&2; exit 1; }
echo "  /api/meta ok"
curl -sf -o /dev/null "http://127.0.0.1:7911/" || { echo "✖ 首页不可用" >&2; exit 1; }
echo "  web 资源 ok"
curl -sf -o /dev/null "http://127.0.0.1:7911/app.js" || { echo "✖ 静态资源路径错误" >&2; exit 1; }
echo "  静态资源路径 ok"

echo ""
echo "✓ 发布包冒烟通过（安装 / CLI / 本地服务 / 静态资源 全部可用）"
