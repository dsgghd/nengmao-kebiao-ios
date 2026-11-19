#!/usr/bin/env python3
"""一键跑完 Windows 上能做的全部校验。

  1. tools/make_assets.py --check      资源目录 / AppIcon 尺寸与 alpha
  2. tools/gen_xcodeproj.py            重新生成 pbxproj（幂等）
  3. tools/validate_project.py         工程结构、资源引用、Info.plist
  4. tools/check_swift.py              tree-sitter Swift 语法解析
  5. tools/web_layer_tests.py          headless Edge 实测注入脚本 + 真实 app.js

用法: python tools/run_all_checks.py [--skip-web]
"""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)


def run(label: str, args: list[str], required: bool = True) -> bool:
    print("\n=== %s ===" % label)
    proc = subprocess.run([sys.executable] + args, cwd=IOS_BUILD)
    if proc.returncode != 0:
        print("-> %s 失败（exit %d）" % (label, proc.returncode))
        if required:
            return False
    return True


def main() -> int:
    skip_web = "--skip-web" in sys.argv
    steps = [
        ("资源与图标", ["tools/make_assets.py", "--check"], True),
        ("重新生成 Xcode 工程", ["tools/gen_xcodeproj.py"], True),
        ("工程结构与 Info.plist", ["tools/validate_project.py"], True),
        ("Swift 语法解析（tree-sitter）", ["tools/check_swift.py"], True),
        ("Swift 类型检查（全部 10 文件，对桩模块）", ["tools/swift_typecheck.py"], False),
        ("API 审计（对 Apple 头文件）", ["tools/sdk_api_audit.py"], False),
        ("Swift 真编译单测（JSLiteral / WebAssetPath / CourseMerger）", ["tools/swift_unit_tests.py"], False),
    ]
    if not skip_web:
        steps.append(("网页层测试 · Chromium/Edge", ["tools/web_layer_tests.py"], True))
        steps.append(("网页层测试 · WebKit（Safari 同族）", ["tools/webkit_tests.py"], False))
        steps.append(("端到端 · 注入层 + 真实 EAMS 解析脚本", ["tools/import_e2e_tests.py"], False))

    ok = True
    for label, args, required in steps:
        ok = run(label, args, required) and ok

    print()
    if ok:
        print("全部校验通过。下一关必须在 macOS 上做：xcodebuild 编译 + 真机验证。")
        return 0
    print("有校验未通过，见上面的输出。")
    return 1


if __name__ == "__main__":
    sys.exit(main())