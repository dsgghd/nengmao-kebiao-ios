#!/bin/sh
set -e
cd "$(dirname "$0")"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "缺少 xcodegen，先执行：brew install xcodegen"
  exit 1
fi
xcodegen generate
echo "已生成 NengmaoKeBiao.xcodeproj，用 Xcode 打开并设置 Signing Team。"