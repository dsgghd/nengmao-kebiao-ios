#!/usr/bin/env python3
"""一次性装好本机校验需要的工具（Windows）。

装了这些，“能验证的部分”就都能量化了；装不上的会跳过对应测试，不影响其它测试。

  1. tree-sitter + tree_sitter_swift    Swift 语法解析（tools/check_swift.py）
  2. playwright + WebKit                真 WebKit 引擎复验网页层（tools/webkit_tests.py）
  3. Swift for Windows                  真编译两个纯 Foundation 模块（tools/swift_unit_tests.py）
     —— Swift 官方要求 MSVC + Windows SDK，本脚本会用 winget 一起装。

用法: python scripts/setup_tools.py [--skip-swift]
"""
from __future__ import annotations

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
VENDOR = os.path.join(IOS_BUILD, ".tools-py")
BROWSERS = os.path.join(VENDOR, "pw-browsers")


def run(label: str, args: list[str], env: dict | None = None) -> bool:
    print("\n>>> %s" % label)
    proc = subprocess.run(args, env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    tail = (proc.stdout or "").strip().splitlines()[-6:]
    for line in tail:
        print("    " + line)
    if proc.returncode != 0:
        err = (proc.stderr or "").strip().splitlines()[-6:]
        for line in err:
            print("    ! " + line)
        print("    -> 失败（exit %d），相关测试会被跳过" % proc.returncode)
        return False
    return True


def find_winget() -> str | None:
    for name in ("winget.exe", "winget"):
        found = subprocess.run(["where", name], capture_output=True, text=True).stdout.strip()
        if found:
            return found.splitlines()[0].strip()
    return None


def main() -> int:
    os.makedirs(VENDOR, exist_ok=True)
    ok = True

    ok &= run("pip: tree-sitter + tree_sitter_swift",
              [sys.executable, "-m", "pip", "install", "--quiet", "--target", VENDOR,
               "tree_sitter", "tree_sitter_swift"])

    if run("pip: playwright",
           [sys.executable, "-m", "pip", "install", "--quiet", "--target", VENDOR, "playwright"]):
        env = dict(os.environ)
        env["PLAYWRIGHT_BROWSERS_PATH"] = BROWSERS
        run("playwright: 下载 WebKit 引擎",
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, r'%s'); from playwright.__main__ import main; "
             "sys.argv = ['playwright', 'install', 'webkit']; main()" % VENDOR],
            env=env)
    else:
        ok = False

    if "--skip-swift" not in sys.argv:
        swiftc = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Swift",
                              "Toolchains")
        if os.path.isdir(swiftc):
            print("\n>>> Swift 工具链已存在，跳过")
        else:
            winget = find_winget()
            if not winget:
                print("\n>>> 没有 winget，跳过 Swift 工具链")
            else:
                run("winget: Swift.Toolchain",
                    [winget, "install", "--id", "Swift.Toolchain", "--exact", "--silent",
                     "--accept-package-agreements", "--accept-source-agreements"])
                # Swift 官方要求 MSVC + Windows SDK（编译 x86intrin.h / 链接 CRT）
                run("winget: VS Build Tools（MSVC + Windows SDK）",
                    [winget, "install", "--id", "Microsoft.VisualStudio.2022.BuildTools", "--exact",
                     "--silent", "--accept-package-agreements", "--accept-source-agreements",
                     "--override",
                     "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools "
                     "--add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"])

    print("\n完成。下一步：python tools/run_all_checks.py")
    return 0 if ok else 0  # 工具缺失不算失败，测试会自动跳过


if __name__ == "__main__":
    sys.exit(main())