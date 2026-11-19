#!/usr/bin/env bash
# 拿到 Xcode.xip / Xcode.app 之后，一条命令出 .app / .ipa（在 WSL 里跑）
#
# 用法：
#   wsl -d NengmaoLinux -u root -- bash /mnt/c/.../install/wsl/build_with_xcode.sh /mnt/c/Users/你/Downloads/Xcode.xip
#   wsl -d NengmaoLinux -u root -- bash .../build_with_xcode.sh /mnt/c/.../Xcode.xip --slim --ipa
#
# 说明：
#   * Xcode.xip 需要你自己的 Apple ID 从 https://developer.apple.com/download/all/?q=Xcode 下载（约 3.5 GB）。
#     xtool 的源码写死了这个来源（sdk install 只接受 Xcode.xip / Xcode.app / darwin.xtoolsdk）。
#   * 不传 --sign 时只打包不签名；签名需要在 WSL 里 `xtool auth login`（Apple ID + 2FA）。
set -uo pipefail

XCODE_PATH="${1:-}"
shift || true
SLIM=""
IPA=""
SIGN=""
for arg in "$@"; do
  case "$arg" in
    --slim) SLIM="--slim" ;;
    --ipa)  IPA="--ipa" ;;
    --sign) SIGN="--sign" ;;
  esac
done

REPO="/mnt/c/Users/Administrator/Documents/Qoder/2026-11-16/2b4fcef7"
XT=/opt/xtool/xtool-x86_64.AppImage
[ -x /opt/xtool/squashfs-root/AppRun ] && XT=/opt/xtool/squashfs-root/AppRun

if [ -z "$XCODE_PATH" ]; then
  echo "用法: bash build_with_xcode.sh <Xcode.xip|Xcode.app|darwin.xtoolsdk> [--slim] [--ipa] [--sign]" >&2
  exit 2
fi
if [ ! -e "$XCODE_PATH" ]; then
  echo "找不到 $XCODE_PATH —— WSL 里 Windows 盘挂在 /mnt/c 下，路径要写成 /mnt/c/..." >&2
  exit 2
fi

export PATH=/opt/swift/usr/bin:$PATH
export DEBIAN_FRONTEND=noninteractive
# SwiftPM 清单与链接需要的宿主依赖（缺了会报 crtbeginS.o / libtool / libxml2）
apt-get install -y --no-install-recommends gcc libgcc-11-dev libxml2 unzip xz-utils >/dev/null 2>&1 || true

echo "== 1. 安装 Darwin Swift SDK（$XCODE_PATH ${SLIM:-}）"
"$XT" sdk install "$XCODE_PATH" $SLIM || { echo "sdk install 失败" >&2; exit 1; }
"$XT" sdk status || true

echo "== 2. 构建"
cd "$REPO/install/xtool" || exit 1
BUILD_ARGS="--triple arm64-apple-ios -c release"
[ -n "$IPA" ] && BUILD_ARGS="$BUILD_ARGS --ipa"
[ -n "$SIGN" ] && BUILD_ARGS="$BUILD_ARGS --sign"
echo "   xtool dev build $BUILD_ARGS"
# shellcheck disable=SC2086
"$XT" dev build $BUILD_ARGS

echo "== 3. 产物"
find "$REPO/install/xtool" -maxdepth 4 \( -name '*.ipa' -o -name '*.app' \) 2>/dev/null | head -10
echo
echo "如果只拿到 .app（未签名），Windows 侧用 Sideloadly / AltStore 用你的 Apple ID 签名安装；"
echo "如果想要 xtool 自己签：先 $XT auth login，再加 --sign 重跑本脚本。"