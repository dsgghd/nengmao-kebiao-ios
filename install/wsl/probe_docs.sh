#!/usr/bin/env bash
# 从 WSL2 里查 xtool 文档中关于 SDK 获取方式的说明（Windows 侧 TLS 不稳，WSL 网络更稳）
set -uo pipefail

echo "##### Documentation 里与 sdk/install 有关的文件"
curl -fsSL --retry 6 --retry-delay 2 \
  'https://api.github.com/repos/xtool-org/xtool/git/trees/main?recursive=1' \
  | tr ',' '\n' | grep -o '"path":"Documentation[^"]*"' \
  | sed 's/"path":"//; s/"$//' | grep -iE 'sdk|install|linux' | head -20

echo
echo "##### 抓 Installation(SDK) 文档正文（若存在）"
for f in \
  Documentation/xtool.docc/Installation.md \
  Documentation/xtool.docc/SDK.md \
  Documentation/xtool.docc/GettingStarted.md ; do
  url="https://raw.githubusercontent.com/xtool-org/xtool/main/$f"
  code=$(curl -fsSL -o /tmp/doc.md -w '%{http_code}' --retry 3 --retry-delay 2 "$url" 2>/dev/null || echo 000)
  if [ "$code" = "000" ]; then continue; fi
  echo "----- $f ($code)"
  head -40 /tmp/doc.md
done