#!/usr/bin/env bash
# 在 Linux（或 WSL 里的 Ubuntu）上用 xtool 把「能猫课表」编成 iOS App。
#
# 为什么需要 Linux：xtool 只发布 Linux AppImage 和 macOS .app，Windows 走的是 WSL。
# 本仓库已下载并校验过 AppImage（sha256 与 GitHub release 摘要一致），可以离线拷过去用。
#
# 用法（在 Linux 上，于本目录执行）：
#   bash setup_and_build.sh                    # 默认：装 xtool → 拉 SDK → 编译 → 出 ipa
#   bash setup_and_build.sh --skip-setup       # 只编译（xtool 和 SDK 已就绪）
#
# 前置：swift 6.x（xtool 依赖宿主 Swift 工具链）、curl、fuse（AppImage 需要）
set -euo pipefail

cd "$(dirname "$0")"
SKIP_SETUP=0
[[ "${1:-}" == "--skip-setup" ]] && SKIP_SETUP=1

XT="./xtool-x86_64.AppImage"
[[ -f "$XT" ]] || XT="${XT_URL:-$HOME/xtool-x86_64.AppImage}"

if [[ ! -x "$XT" ]]; then
  echo "==> 下载 xtool 1.24.0"
  curl -fL --retry 8 --retry-delay 3 \
    -o "$XT" \
    https://github.com/xtool-org/xtool/releases/download/1.24.0/xtool-x86_64.AppImage
  chmod +x "$XT"
fi

echo "==> 校验 sha256（GitHub release 里给的摘要）"
EXPECTED="dbfd9d7216f077c84c171b688c4173c37c23ca76bf7fd185d1a9ae8a53dab59f"
ACTUAL="$(sha256sum "$XT" | cut -d' ' -f1)"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  echo "sha256 不匹配：$ACTUAL" >&2
  exit 1
fi
echo "    ok: $ACTUAL"

if [[ $SKIP_SETUP -eq 0 ]]; then
  echo "==> xtool setup（下载 Darwin Swift SDK；会要求登录 Apple ID，用于签名/安装）"
  "$XT" setup
fi

echo "==> 可用子命令"
"$XT" --help || true

echo
echo "==> 编译（xtool dev）"
echo "    注意：xtool dev 默认会尝试装到设备上。没有设备时用 --help 看当前版本支持哪些"
echo "    “只打包不安装”的开关，然后按提示执行，例如："
echo "        $XT dev --help"
echo
echo "    编出来的 .app / .ipa 一般落在 .build/ 或 ./out 下，具体路径以 xtool 输出为准。"
"$XT" dev

echo
echo "==> 产物"
ls -R .build 2>/dev/null | head -40 || true
find . -maxdepth 3 -name '*.ipa' -o -maxdepth 3 -name '*.app' 2>/dev/null | head -10 || true