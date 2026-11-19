#!/usr/bin/env bash
# 在 WSL 的 Ubuntu 里执行：装依赖 → 装 Swift(Linux) → 跑 xtool 构建
# 由 install/wsl/setup_after_reboot.ps1 调用（root 身份）。
set -uo pipefail

say() { printf '\n\033[36m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[33m!! %s\033[0m\n' "$*"; }

say "0. 基本信息"
uname -a || true
cat /etc/os-release | head -3 || true

say "1. apt 依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y || warn "apt-get update 失败，后面可能装不上"
apt-get install -y --no-install-recommends \
  curl ca-certificates libc6-dev binutils libedit2 libgcc-s1 libstdc++6 \
  libpython3.10 zlib1g unzip xz-utils libfuse2 git || warn "部分依赖安装失败"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "仓库路径: $REPO"

say "2. Swift 工具链（xtool 依赖宿主 Swift）"
if command -v swift >/dev/null 2>&1; then
  echo "已存在: $(swift --version 2>&1 | head -1)"
else
  SWIFT_VER="6.0.3"
  URL="https://download.swift.org/swift-${SWIFT_VER}-release/ubuntu2204/swift-${SWIFT_VER}-RELEASE/swift-${SWIFT_VER}-RELEASE-ubuntu22.04.tar.gz"
  if ! command -v swift >/dev/null 2>&1; then
    say "   下载 $URL"
    if curl -fL --retry 6 --retry-delay 3 -o /tmp/swift.tar.gz "$URL"; then
      mkdir -p /opt/swift && tar -xzf /tmp/swift.tar.gz -C /opt/swift --strip-components=1
      ln -sf /opt/swift/usr/bin/swift /usr/local/bin/swift
      ln -sf /opt/swift/usr/bin/swiftc /usr/local/bin/swiftc
      echo "   installed: $(swift --version 2>&1 | head -1)"
    else
      warn "Swift 下载失败（版本号可能需要更新，见 https://www.swift.org/install/linux/）"
    fi
  fi
fi

say "3. xtool"
XT_WIN="/mnt/c/Users/$(cmd.exe /c 'echo %USERNAME%' 2>/dev/null | tr -d '\r')/sdks/xtool/xtool-x86_64.AppImage"
XT_LOCAL=""
for cand in "$XT_WIN" "/mnt/c/Users/Administrator/sdks/xtool/xtool-x86_64.AppImage"; do
  [[ -f "$cand" ]] && XT_LOCAL="$cand" && break
done
if [[ -z "$XT_LOCAL" ]]; then
  warn "WSL 里找不到 Windows 侧下载好的 AppImage，改为下载"
  XT_LOCAL=/opt/xtool/xtool-x86_64.AppImage
  mkdir -p /opt/xtool
  curl -fL --retry 8 --retry-delay 3 -o "$XT_LOCAL" \
    https://github.com/xtool-org/xtool/releases/download/1.24.0/xtool-x86_64.AppImage || warn "xtool 下载失败"
fi

if [[ -f "$XT_LOCAL" ]]; then
  chmod +x "$XT_LOCAL"
  echo "sha256: $(sha256sum "$XT_LOCAL" | cut -d' ' -f1)"
  # AppImage 依赖 FUSE；WSL1 里常常没有，直接解包运行
  XT="$XT_LOCAL"
  if ! "$XT" --help >/dev/null 2>&1; then
    say "   AppImage 直接执行失败，改为解包"
    cd /opt/xtool 2>/dev/null || mkdir -p /opt/xtool && cd /opt/xtool
    "$XT_LOCAL" --appimage-extract >/dev/null 2>&1 && XT="/opt/xtool/squashfs-root/AppRun"
    [[ -x "$XT" ]] || warn "解包后仍找不到 AppRun"
  fi
  "$XT" --help 2>&1 | head -20 || true

  say "4. xtool setup（需要登录 Apple ID 才能签名；只想编译可先按 Ctrl-C 跳过）"
  "$XT" setup || warn "setup 未完成（下载 Darwin SDK / 登录）"

  say "5. 用 xtool 构建本工程"
  cd "$REPO/install/xtool" || exit 1
  "$XT" dev || {
    warn "xtool dev 失败——把上面的报错贴回来，重点看三类："
    warn "  a) Package.swift 依赖 PACKAGE_NAME"
    warn "  b) import Network/UserNotifications/Security 找不到模块"
    warn "  c) UIKit 的 @main 与 xtool 入口冲突"
  }
  say "6. 产物"
  find . -maxdepth 4 \( -name '*.ipa' -o -name '*.app' \) 2>/dev/null | head -10
else
  warn "没有 xtool 可执行文件，停在这里"
fi