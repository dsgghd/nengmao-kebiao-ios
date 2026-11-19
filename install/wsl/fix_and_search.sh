#!/usr/bin/env bash
set -uo pipefail
REPO=/mnt/c/Users/Administrator/Documents/Qoder/2026-11-16/2b4fcef7
export PATH=/opt/swift/usr/bin:$PATH
export DEBIAN_FRONTEND=noninteractive

echo "##### 1) 补 Swift 运行期依赖"
apt-get install -y --no-install-recommends libxml2 libncurses6 libcurl4 libsqlite3-0 >/tmp/apt2.log 2>&1
echo "apt exit=$?"
tail -2 /tmp/apt2.log

echo
echo "##### 2) 再试 swift package dump-package"
cd "$REPO/install/xtool" || exit 1
timeout 300 swift package --disable-sandbox dump-package > /tmp/pkg.json 2>/tmp/pkg.err
echo "exit=$?"
head -5 /tmp/pkg.err
if [ -s /tmp/pkg.json ]; then
  python3 - <<'PY'
import json
d = json.load(open('/tmp/pkg.json'))
print('name:', d.get('name'))
t = d.get('targets', [{}])[0]
print('target:', t.get('name'), '| type:', t.get('type'), '| path:', t.get('path'))
print('exclude:', t.get('exclude'))
print('products:', [(p.get('name'), p.get('type')) for p in d.get('products', [])])
PY
fi

echo
echo "##### 3) 搜有没有现成的 darwin.xtoolsdk / iOS Swift SDK 包"
for q in xtoolsdk "darwin%20swift%20sdk" "ios%20swift%20sdk%20bundle"; do
  echo "--- query: $q"
  curl -fsSL --max-time 25 "https://api.github.com/search/repositories?q=$q&per_page=5" 2>/dev/null \
    | tr ',' '\n' | grep -o '"full_name":"[^"]*"' | sed 's/"full_name":"//; s/"$//' | head -5
done