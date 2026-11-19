#!/usr/bin/env bash
# 在 macOS 上编译能猫课表 iOS 版。三种模式：
#   ./scripts/build.sh simulator   模拟器编译（不需要签名，最快验证 Swift 能不能过）
#   ./scripts/build.sh archive     真机/归档（需要先设置 DEVELOPMENT_TEAM）
#   ./scripts/build.sh check       只跑静态校验（工程/资源/图标/网页层），不编译
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-simulator}"
DERIVED="build/DerivedData"

case "$MODE" in
  check)
    python3 tools/make_assets.py --check
    python3 tools/validate_project.py
    python3 tools/check_swift.py
    # 在 Mac 上自动用 Xcode 自带的 iPhoneOS.sdk 做 API 审计（Windows 上需要先 --fetch）
    python3 tools/sdk_api_audit.py || echo "（API 审计被跳过或未通过，见上面的输出）"
    python3 tools/web_layer_tests.py || echo "（网页层测试需要 Edge/Chrome，macOS 上可跳过）"
    ;;

  simulator)
    xcodebuild \
      -project NengmaoKeBiao.xcodeproj \
      -scheme NengmaoKeBiao \
      -configuration Debug \
      -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$DERIVED" \
      CODE_SIGNING_ALLOWED=NO \
      build
    echo
    echo "编译通过。产物：$DERIVED/Build/Products/Debug-iphonesimulator/NengmaoKeBiao.app"
    ;;

  archive)
    TEAM="${DEVELOPMENT_TEAM:-}"
    if [ -z "$TEAM" ]; then
      echo "先设置团队 ID：export DEVELOPMENT_TEAM=ABCDE12345（Xcode 里也能看到）" >&2
      exit 1
    fi
    xcodebuild \
      -project NengmaoKeBiao.xcodeproj \
      -scheme NengmaoKeBiao \
      -configuration Release \
      -destination 'generic/platform=iOS' \
      -archivePath build/NengmaoKeBiao.xcarchive \
      -derivedDataPath "$DERIVED" \
      DEVELOPMENT_TEAM="$TEAM" \
      CODE_SIGN_STYLE=Automatic \
      archive
    echo
    echo "归档完成：build/NengmaoKeBiao.xcarchive"
    echo "导出 IPA：Xcode → Window → Organizer → Distribute App（Ad Hoc / TestFlight）"
    ;;

  *)
    echo "用法: $0 [simulator|archive|check]" >&2
    exit 2
    ;;
esac