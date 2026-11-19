#!/usr/bin/env python3
"""静态校验 ios-build 工程：project.pbxproj、Info.plist、资源、图标。

Windows 上没有 Xcode，跑不了 xcodebuild；这里把“能在本地证明的部分”全部证明掉：

  1. project.pbxproj 能被 OpenStep plist 解析，UUID 引用全部闭合，rootObject 有效；
  2. 每个 PBXFileReference 指向的文件/目录真实存在（相对 app 组路径）；
  3. Sources 阶段列全 Swift 文件，Resources 阶段列全 Web/、Scripts/、Assets.xcassets；
  4. Web/、Scripts/ 是 folder reference（否则 Bundle.main.url(forResource:"Web") 会失败）；
  5. 构建配置里 INFOPLIST_FILE / BUNDLE_ID / AppIcon / AccentColor 都在且指向真实文件；
  6. Info.plist 必填键齐全，UILaunchScreen 引用的颜色/图片资源真的存在；
  7. AppIcon 全套尺寸正确、无 alpha（复用 tools/make_assets.py --check）。

退出码 0 = 全部通过。
"""
from __future__ import annotations

import os
import plistlib
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
PBXPROJ = os.path.join(IOS_BUILD, "NengmaoKeBiao.xcodeproj", "project.pbxproj")

sys.path.insert(0, HERE)

failures: list[str] = []
warnings: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# ---------------------------------------------------------------- OpenStep 解析

class Parser:
    def __init__(self, text: str):
        self.s = text
        self.i = 0

    def skip_ws(self) -> None:
        s, n = self.s, len(self.s)
        while self.i < n:
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif s.startswith("/*", self.i):
                end = s.find("*/", self.i + 2)
                self.i = n if end < 0 else end + 2
            elif s.startswith("//", self.i):
                end = s.find("\n", self.i + 2)
                self.i = n if end < 0 else end + 1
            else:
                break

    def parse_value(self):
        self.skip_ws()
        c = self.s[self.i]
        if c == "{":
            return self.parse_dict()
        if c == "(":
            return self.parse_array()
        if c == '"':
            return self.parse_quoted()
        if c == "<":
            end = self.s.index(">", self.i)
            raw = self.s[self.i + 1:end]
            self.i = end + 1
            return raw
        return self.parse_bare()

    def parse_dict(self) -> dict:
        assert self.s[self.i] == "{"
        self.i += 1
        out = {}
        while True:
            self.skip_ws()
            if self.s[self.i] == "}":
                self.i += 1
                return out
            key = self.parse_value()
            self.skip_ws()
            if self.s[self.i] != "=":
                raise ValueError("expected = at %d" % self.i)
            self.i += 1
            value = self.parse_value()
            self.skip_ws()
            if self.s[self.i] != ";":
                raise ValueError("expected ; after key %r at offset %d" % (key, self.i))
            self.i += 1
            out[key] = value

    def parse_array(self) -> list:
        assert self.s[self.i] == "("
        self.i += 1
        out = []
        while True:
            self.skip_ws()
            if self.s[self.i] == ")":
                self.i += 1
                return out
            out.append(self.parse_value())
            self.skip_ws()
            if self.s[self.i] == ",":
                self.i += 1

    def parse_quoted(self) -> str:
        assert self.s[self.i] == '"'
        self.i += 1
        out = []
        while True:
            c = self.s[self.i]
            if c == "\\":
                nxt = self.s[self.i + 1]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, nxt))
                self.i += 2
            elif c == '"':
                self.i += 1
                return "".join(out)
            else:
                out.append(c)
                self.i += 1

    def parse_bare(self) -> str:
        start = self.i
        while self.i < len(self.s) and self.s[self.i] not in ' \t\r\n=;,){}"':
            self.i += 1
        return self.s[start:self.i]


def load_pbxproj(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if not text.startswith("// !$*UTF8*$!"):
        fail("project.pbxproj 缺少 OpenStep 文件头 // !$*UTF8*$!")
    parser = Parser(text)
    return parser.parse_value()


# ---------------------------------------------------------------- 校验

def check_uuid_uniqueness(text: str) -> None:
    """同一个 UUID 不能定义两次（定义行以 \t\t<UUID> {isa 开头）。"""
    defined = re.findall(r"^\t\t([0-9A-F]{24}) = \{isa =", text, re.MULTILINE)
    seen = {}
    for uuid in defined:
        seen[uuid] = seen.get(uuid, 0) + 1
    dupes = [u for u, n in seen.items() if n > 1]
    if dupes:
        fail("project.pbxproj 有重复定义的对象 ID: %s" % ", ".join(dupes))
    if not defined:
        fail("project.pbxproj 里没有解析到任何对象定义")


def collect_refs(node, acc: set) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("fileRef", "buildConfigurationList", "mainGroup", "productRefGroup",
                     "productReference", "buildPhases", "targets", "children", "files",
                     "buildConfigurations", "rootObject"):
                if isinstance(v, str):
                    acc.add(v)
                elif isinstance(v, list):
                    acc.update(x for x in v if isinstance(x, str))
            collect_refs(v, acc)
    elif isinstance(node, list):
        for item in node:
            collect_refs(item, acc)


def main() -> int:
    if not os.path.isfile(PBXPROJ):
        fail("找不到 %s（先跑 tools/gen_xcodeproj.py）" % PBXPROJ)
        return report()

    with open(PBXPROJ, encoding="utf-8") as fh:
        raw = fh.read()
    try:
        root = load_pbxproj(PBXPROJ)
    except Exception as exc:  # noqa: BLE001
        fail("project.pbxproj 解析失败: %s" % exc)
        return report()

    check_uuid_uniqueness(raw)

    objects = root.get("objects", {})
    if not objects:
        fail("objects 为空")
        return report()

    # 1) 引用闭合
    refs: set = set()
    collect_refs(root, refs)
    missing = sorted(r for r in refs if r not in objects)
    if missing:
        fail("有 %d 个引用指向不存在的对象: %s" % (len(missing), ", ".join(missing[:5])))

    # 2) file reference 落盘检查
    for uuid, obj in objects.items():
        if not isinstance(obj, dict) or obj.get("isa") != "PBXFileReference":
            continue
        path = obj.get("path")
        tree = obj.get("sourceTree")
        if not path or not isinstance(path, str):
            continue
        if obj.get("explicitFileType", "").endswith("wrapper.application"):
            continue
        candidate = os.path.join(APP_DIR, path)
        if not os.path.exists(candidate):
            fail("PBXFileReference 指向的文件不存在: %s (uuid %s)" % (candidate, uuid))
        if obj.get("lastKnownFileType") == "folder" and not os.path.isdir(candidate):
            fail("folder reference 指的却是文件: %s" % candidate)

    # 3) Sources / Resources 阶段
    target = None
    for uuid, obj in objects.items():
        if isinstance(obj, dict) and obj.get("isa") == "PBXNativeTarget":
            target = obj
            break
    if target is None:
        fail("没有 PBXNativeTarget")
        return report()

    phase_files = {}
    for phase_id in target.get("buildPhases", []):
        phase = objects.get(phase_id, {})
        names = []
        for bf_id in phase.get("files", []):
            bf = objects.get(bf_id, {})
            ref = objects.get(bf.get("fileRef", ""), {})
            names.append(ref.get("path", "<unknown>"))
        phase_files[phase.get("isa", "?")] = names

    sources = phase_files.get("PBXSourcesBuildPhase", [])
    resources = phase_files.get("PBXResourcesBuildPhase", [])

    wanted_sources = sorted(f for f in os.listdir(APP_DIR) if f.endswith(".swift"))
    if sorted(sources) != wanted_sources:
        fail("Sources 阶段不匹配：期望 %s，实际 %s" % (wanted_sources, sorted(sources)))

    for expected in ("Assets.xcassets", "Web", "Scripts"):
        if expected not in resources:
            fail("Resources 阶段缺少 %s" % expected)
    if "Info.plist" in resources:
        fail("Info.plist 不应该出现在 Copy Bundle Resources")

    for name in ("Web", "Scripts"):
        for obj in objects.values():
            if isinstance(obj, dict) and obj.get("isa") == "PBXFileReference" and obj.get("path") == name:
                if obj.get("lastKnownFileType") != "folder":
                    fail("%s 不是 folder reference（lastKnownFileType=%s）" % (name, obj.get("lastKnownFileType")))
                break

    # 4) 构建配置
    settings = {}
    for cfg_id in target.get("buildConfigurationList", []) and objects.get(target.get("buildConfigurationList"), {}).get("buildConfigurations", []):
        cfg = objects.get(cfg_id, {})
        settings[cfg.get("name", "?")] = cfg.get("buildSettings", {})
    if not settings:
        fail("target 没有 build configuration")

    for name, values in settings.items():
        plist_rel = values.get("INFOPLIST_FILE", "")
        if plist_rel != "NengmaoKeBiao/Info.plist":
            fail("%s: INFOPLIST_FILE 应为 NengmaoKeBiao/Info.plist，实际 %r" % (name, plist_rel))
        elif not os.path.isfile(os.path.join(IOS_BUILD, plist_rel)):
            fail("%s: INFOPLIST_FILE 指向的文件不存在" % name)
        if values.get("ASSETCATALOG_COMPILER_APPICON_NAME") != "AppIcon":
            fail("%s: ASSETCATALOG_COMPILER_APPICON_NAME 缺失" % name)
        if values.get("ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME") != "AccentColor":
            fail("%s: AccentColor 未设置" % name)
        if values.get("TARGETED_DEVICE_FAMILY") not in ("1", 1):
            warn("%s: TARGETED_DEVICE_FAMILY=%r（当前项目只做 iPhone）" % (name, values.get("TARGETED_DEVICE_FAMILY")))
        if values.get("GENERATE_INFOPLIST_FILE") not in ("NO", False):
            fail("%s: GENERATE_INFOPLIST_FILE 必须是 NO，否则会覆盖手写 Info.plist" % name)
        if "PRODUCT_BUNDLE_IDENTIFIER" not in values:
            fail("%s: 缺少 PRODUCT_BUNDLE_IDENTIFIER" % name)
        if values.get("SWIFT_VERSION") != "5.0":
            warn("%s: SWIFT_VERSION=%r" % (name, values.get("SWIFT_VERSION")))
        if "DEVELOPMENT_TEAM" not in values:
            warn("%s: 没有 DEVELOPMENT_TEAM（首次在 Xcode 里选 Team 即可）" % name)

    # 5) Info.plist
    info_path = os.path.join(APP_DIR, "Info.plist")
    try:
        with open(info_path, "rb") as fh:
            info = plistlib.load(fh)
    except Exception as exc:  # noqa: BLE001
        fail("Info.plist 解析失败: %s" % exc)
        info = {}

    for key in ("CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundlePackageType",
                "CFBundleShortVersionString", "CFBundleVersion", "LSRequiresIPhoneOS",
                "UILaunchScreen", "UISupportedInterfaceOrientations", "CFBundleIconName"):
        if key not in info:
            fail("Info.plist 缺少 %s" % key)
    if info.get("CFBundleIconName") not in (None, "AppIcon"):
        fail("CFBundleIconName 应为 AppIcon")
    if info.get("UISupportedInterfaceOrientations") not in (None, ["UIInterfaceOrientationPortrait"]):
        warn("Info.plist 方向: %r" % info.get("UISupportedInterfaceOrientations"))

    ats = info.get("NSAppTransportSecurity", {})
    if not ats.get("NSAllowsArbitraryLoadsInWebContent"):
        fail("缺少 NSAllowsArbitraryLoadsInWebContent（校内 http 教务页打不开）")
    if not ats.get("NSAllowsLocalNetworking"):
        fail("缺少 NSAllowsLocalNetworking（127.0.0.1 本地课表服务探活会走 ATS）")
    if ats.get("NSAllowsArbitraryLoads"):
        warn("不要加 NSAllowsArbitraryLoads，会把原生网络也放开")

    launch = info.get("UILaunchScreen", {})
    if isinstance(launch, dict):
        color = launch.get("UIColorName")
        if color and not os.path.isdir(os.path.join(APP_DIR, "Assets.xcassets", color + ".colorset")):
            fail("UILaunchScreen 引用的颜色 %s 不存在" % color)
        image = launch.get("UIImageName")
        if image and not os.path.isdir(os.path.join(APP_DIR, "Assets.xcassets", image + ".imageset")):
            fail("UILaunchScreen 引用的图片 %s 不存在" % image)

    # 6) 资源与图标
    try:
        import make_assets
        if make_assets.check_assets() != 0:
            fail("Assets.xcassets 校验未通过（见上面的输出）")
    except SystemExit:
        fail("Assets.xcassets 校验脚本异常退出")
    except Exception as exc:  # noqa: BLE001
        fail("无法运行 make_assets 校验: %s" % exc)

    # 7) 关键运行期文件存在
    for rel in ("Web/index.html", "Web/app.js", "Web/parser.js", "Web/schools-seed.js",
                "Web/vendor/xlsx.full.min.js", "Scripts/eams-scrape.js", "Scripts/generic-scrape.js"):
        if not os.path.isfile(os.path.join(APP_DIR, rel)):
            fail("缺少运行期资源 %s" % rel)

    check_bundle_resource_literals()

    return report()


def check_bundle_resource_literals() -> None:
    """源码里 `Bundle.main.url(forResource:withExtension:subdirectory:)` 引用的资源必须真存在。

    这条检查防的是“代码里写着 Web/index.html，但资源没打进包”——那种错误在 Windows 上看不出来，
    到真机就是白屏。
    """
    pattern = re.compile(
        r'forResource:\s*"([^"]+)"\s*,\s*withExtension:\s*(nil|"([^"]*)")(?:\s*,\s*subdirectory:\s*"([^"]+)")?')
    for name in sorted(f for f in os.listdir(APP_DIR) if f.endswith(".swift")):
        with open(os.path.join(APP_DIR, name), encoding="utf-8") as fh:
            text = fh.read()
        for match in pattern.finditer(text):
            resource, ext_raw, ext, subdir = match.groups()
            filename = resource if ext_raw == "nil" else "%s.%s" % (resource, ext)
            candidates = []
            if subdir:
                candidates.append(os.path.join(APP_DIR, subdir, filename))
            candidates.append(os.path.join(APP_DIR, filename))
            # 不带 subdirectory 的调用是“资源被拍平”时的兜底写法，
            # 只要工程里某个子目录下有同名文件就算它在包里（folder reference 会保留目录）。
            if not subdir:
                for entry in os.listdir(APP_DIR):
                    nested = os.path.join(APP_DIR, entry, filename)
                    if os.path.exists(nested):
                        candidates.append(nested)
            if not any(os.path.exists(c) for c in candidates):
                line = text[:match.start()].count("\n") + 1
                fail("%s:%d 引用的资源不存在：%s（试过 %s）"
                     % (name, line, filename, ", ".join(os.path.relpath(c, APP_DIR) for c in candidates)))


def report() -> int:
    if warnings:
        print("警告：")
        for w in warnings:
            print("  - " + w)
    if failures:
        print("工程校验失败（%d 项）：" % len(failures))
        for f in failures:
            print("  - " + f)
        return 1
    print("工程校验通过：project.pbxproj、Info.plist、资源引用、AppIcon 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())