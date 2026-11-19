#!/usr/bin/env bash
# 查：有没有现成的 darwin.xtoolsdk 可下载（不依赖 Xcode.xip）
set -uo pipefail

echo "##### 1) xtool-org 下有哪些仓库"
curl -fsSL --retry 6 --retry-delay 2 'https://api.github.com/users/xtool-org/repos?per_page=50' \
  | tr ',' '\n' | grep -o '"name":"[^"]*"' | sed 's/"name":"//; s/"$//' | sort -u | head -30

echo
echo "##### 2) 最近 3 个 release 的所有资产名"
curl -fsSL --retry 6 --retry-delay 2 'https://api.github.com/repos/xtool-org/xtool/releases?per_page=3' \
  | tr ',' '\n' | grep -o '"name":"[^"]*"' | sed 's/"name":"//; s/"$//' | sort -u | head -40

echo
echo "##### 3) 源码里 sdk 安装是怎么找 SDK 的"
for f in Sources/XToolSupport/SDKCommand.swift Sources/XToolSupport/SetupCommand.swift Sources/PackLib/DarwinSDK.swift ; do
  url="https://raw.githubusercontent.com/xtool-org/xtool/main/$f"
  if curl -fsSL --retry 3 --retry-delay 2 -o /tmp/x.swift "$url" 2>/dev/null; then
    echo "----- $f"
    grep -nE 'xtoolsdk|download|http|Xcode\.xip|slim' /tmp/x.swift | head -20
  fi
done