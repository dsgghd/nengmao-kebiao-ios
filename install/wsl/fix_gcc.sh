#!/usr/bin/env bash
set -uo pipefail
REPO=/mnt/c/Users/Administrator/Documents/Qoder/2026-11-16/2b4fcef7
export PATH=/opt/swift/usr/bin:$PATH
export DEBIAN_FRONTEND=noninteractive

echo "##### 1) 装 gcc / libgcc（SwiftPM 清单需要 crtbeginS.o 和 -lgcc）"
apt-get install -y --no-install-recommends gcc libgcc-11-dev >/tmp/apt3.log 2>&1
echo "apt exit=$?"
tail -2 /tmp/apt3.log

echo
echo "##### 2) swift package dump-package（这一步能真正验证 Package.swift）"
cd "$REPO/install/xtool" || exit 1
timeout 300 swift package --disable-sandbox dump-package > /tmp/pkg.json 2>/tmp/pkg.err
echo "exit=$?"
head -6 /tmp/pkg.err
if [ -s /tmp/pkg.json ]; then
  python3 - <<'PY'
import json
d = json.load(open('/tmp/pkg.json'))
print('package name :', d.get('name'))
print('products     :', [(p.get('name'), p.get('type')) for p in d.get('products', [])])
for t in d.get('targets', []):
    print('target       :', t.get('name'), '| type:', t.get('type'), '| path:', t.get('path'), '| exclude:', t.get('exclude'))
PY
fi

echo
echo "##### 3) 真正跑一次 swift build for iOS（没有 SDK 时应该给出明确缺 SDK 的错）"
cd "$REPO/install/xtool" || exit 1
timeout 240 swift build --triple arm64-apple-ios 2>&1 | head -15