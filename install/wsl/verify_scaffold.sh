#!/usr/bin/env bash
# 在不装 Darwin SDK 的前提下，能验证多少验证多少
set -uo pipefail
REPO=/mnt/c/Users/Administrator/Documents/Qoder/2026-11-16/2b4fcef7
XT=/opt/xtool/xtool-x86_64.AppImage
[ -x /opt/xtool/squashfs-root/AppRun ] && XT=/opt/xtool/squashfs-root/AppRun

export PATH=/opt/swift/usr/bin:$PATH

echo "##### 1) swift 可用性"
timeout 120 swift --version 2>&1 | head -3

echo
echo "##### 2) Package.swift 能否被 SwiftPM 接受（dump-package）"
cd "$REPO/install/xtool" || exit 1
timeout 300 swift package --disable-sandbox dump-package > /tmp/pkg.json 2> /tmp/pkg.err
echo "exit=$?"
head -5 /tmp/pkg.err
if [ -s /tmp/pkg.json ]; then
  echo "--- 关键字段 ---"
  grep -oE '"(name|path|type|exclude|identity)"[^,]{0,80}' /tmp/pkg.json | head -20
fi

echo
echo "##### 3) xtool 认不认这个工程（sdk 未装时的报错就是我们要记录的卡点）"
cd "$REPO/install/xtool" || exit 1
timeout 300 "$XT" dev build 2>&1 | head -40
echo "build exit=$?"

echo
echo "##### 4) GitHub API 速率（判断后面搜索是否被限流）"
curl -fsSL --max-time 20 https://api.github.com/rate_limit 2>/dev/null | tr ',' '\n' | grep -E 'limit|remaining' | head -4