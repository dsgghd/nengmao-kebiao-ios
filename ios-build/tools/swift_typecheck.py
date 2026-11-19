#!/usr/bin/env python3
"""用真 Swift 编译器对**全部 9 个 App 源文件**做类型检查（Windows 上能做的最强关卡）。

做法：
  1. 把 tools/swift_stubs/Stubs.swift 编成模块 AppleStubs —— 里面是 UIKit/WebKit/Network/
     UserNotifications/Security 中本工程用到的 API（按 Apple 文档手写签名）。
  2. 复制 App 源文件到临时目录，做两类**声明过的**改写：
       a. `import UIKit|WebKit|Network|UserNotifications|Security` -> `import AppleStubs`
       b. Windows 版 Foundation 把 HTTPCookie/URLCredential/URLAuthenticationChallenge
          砍成 AnyObject 占位，因此把这几个名字换成桩里的 T* 版本（只换名字，用法不变）。
     改写清单会打印出来，被改写的行数与源文件行数一并核对。
  3. `swiftc -typecheck` 全部文件。

它证明什么：可选值/闭包签名/协议实现/重载/属性名这类**代码自身**的错误。
它不证明什么：桩的签名是我按文档写的，所以“我记的 Apple API 就是 Apple 的 API”这件事，
仍然只能靠 Xcode 的 SDK 来最终确认。

用法: python tools/swift_typecheck.py
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
STUBS = os.path.join(HERE, "swift_stubs", "Stubs.swift")

sys.path.insert(0, HERE)
import swift_unit_tests as sut  # noqa: E402

SOURCES = [
    "MainViewController.swift",
    "ImportViewController.swift",
    "ReminderScheduler.swift",
    "WebStorage.swift",
    "LocalWebServer.swift",
    "CookieVault.swift",
    "JSLiteral.swift",
    "WebAssetPath.swift",
    "CourseMerger.swift",
    "WebStoreFile.swift",
]

FRAMEWORK_IMPORTS = re.compile(
    r"^import (UIKit|WebKit|Network|UserNotifications|Security)\s*$", re.MULTILINE)

# 顺序重要：长的先换，避免 HTTPCookieStorage 被 HTTPCookie 的半截替换搞坏
IDENTIFIER_MAP = [
    ("HTTPCookieStorage", "TCookieStorage"),
    ("HTTPCookie", "TCookie"),
    ("URLCredential", "TCredential"),
    ("URLAuthenticationChallenge", "TChallenge"),
    ("NSURLAuthenticationMethodServerTrust", "TTAuthMethodServerTrust"),
]


OBJC_ATTR = re.compile(r"@objc(?:\([^)]*\))?\s+")
SELECTOR = re.compile(r"#selector\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)")


def rewrite(text: str) -> tuple[str, dict]:
    stats = {"imports": 0, "identifiers": {}, "objc": 0, "selector": 0}

    # UIKit/WebKit 在 Apple 平台上会传递 Foundation；桩模块不传递，这里显式补上
    text, imports = FRAMEWORK_IMPORTS.subn(
        "import Foundation\nimport FoundationNetworking\nimport AppleStubs", text)
    stats["imports"] = imports

    for old, new in IDENTIFIER_MAP:
        count = len(re.findall(r"\b%s\b" % old, text))
        if count:
            text = re.sub(r"\b%s\b" % old, new, text)
            stats["identifiers"][old] = count

    # Windows 上没有 Objective-C 运行时：@objc 与 #selector 都无法编译。
    # 降级成占位（代价：失去“被选中的方法是否存在”这一项检查，README 里写明）。
    text, n = OBJC_ATTR.subn("", text)
    stats["objc"] = n
    text, n = SELECTOR.subn(lambda m: 'TSelector("%s")' % m.group(1), text)
    stats["selector"] = n
    return text, stats


def main() -> int:
    swiftc = sut.find_swiftc()
    if not swiftc:
        print("跳过类型检查：找不到 swiftc（先跑 scripts/setup_tools.py）")
        return 0
    env = sut.build_env(swiftc)
    work = tempfile.mkdtemp(prefix="tt-typecheck-")
    try:
        stub_copy = os.path.join(work, "Stubs.swift")
        shutil.copy2(STUBS, stub_copy)
        module_dir = os.path.join(work, "modules")
        os.makedirs(module_dir, exist_ok=True)
        build_stub = subprocess.run(
            [swiftc, "-swift-version", "5", "-parse-as-library",
             "-emit-module", "-module-name", "AppleStubs",
             "-emit-module-path", os.path.join(module_dir, "AppleStubs.swiftmodule"),
             stub_copy],
            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=600,
        )

        if build_stub.returncode != 0:
            print("桩模块自己编译失败（说明桩写错了，不是 App 的问题）：")
            print((build_stub.stderr or "").strip()[:4000])
            return 1
        print("桩模块编译通过：AppleStubs")

        prepared = []
        total_lines = 0
        for name in SOURCES:
            src = os.path.join(APP_DIR, name)
            with open(src, encoding="utf-8") as fh:
                original = fh.read()
            text, stats = rewrite(original)
            total_lines += original.count("\n") + 1
            dst = os.path.join(work, name)
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(text)
            prepared.append(dst)
            ident = ", ".join("%s×%d" % (k, v) for k, v in stats["identifiers"].items()) or "-"
            print("  %-28s 行数 %-5d import %d；标识符 %s；@objc %d；#selector %d"
                  % (name, original.count("\n") + 1, stats["imports"], ident,
                     stats["objc"], stats["selector"]))

        print("\n开始类型检查（%d 个文件 / %d 行）..." % (len(prepared), total_lines))
        check = subprocess.run(
            [swiftc, "-swift-version", "5", "-parse-as-library", "-typecheck",
             "-I", module_dir] + prepared,
            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=1200,
        )
        out = (check.stderr or "") + (check.stdout or "")
        if check.returncode == 0:
            print("\n类型检查通过：%d 个文件、%d 行没有类型错误。" % (len(prepared), total_lines))
            print("（桩的签名按 Apple 文档手写，仍不等于 Xcode SDK 的最终确认。）")
            return 0

        errors = [line for line in out.splitlines() if re.search(r"error:", line)]
        print("\n类型检查失败，%d 条 error：" % len(errors))
        for line in errors[:40]:
            print("  " + line)
        if len(errors) > 40:
            print("  ...（截断）")
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())