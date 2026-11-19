#!/usr/bin/env python3
"""在 Windows 上用真 Swift 编译器跑两个纯 Foundation 单元测试。

为什么要这么做：iOS 部分没法在 Windows 编译，但工程里有两块**不依赖 UIKit/WebKit**的
逻辑，恰好在真机上出错最难查：

  1. JSLiteral —— 把 Swift 字符串写进注入脚本时的转义。写错 = 注入脚本语法错误 = 存储悄悄失效。
     测法：把 JSLiteral.swift 和探测器一起编成 exe，喂极端字符串，再用 JSON 反解验证往返。
  2. WebAssetPath —— 本地 HTTP 服务的路径解析与 MIME。写错 = 目录穿越或 404 白屏。
     测法：同样编成 exe，跑一批攻击性/正常路径，断言结果。

这两个测试跑的是**仓库里那份源码本身**（不是副本），所以它们是可迁移证据。

用法: python tools/swift_unit_tests.py
依赖: Swift for Windows（winget install --id Swift.Toolchain --exact）
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")

results: list[dict] = []


def record(name: str, ok: bool, detail=None) -> None:
    results.append({"name": name, "pass": bool(ok), "detail": detail})


def find_swiftc() -> str | None:
    found = shutil.which("swiftc")
    if found:
        return found
    patterns = [
        r"C:\Users\*\AppData\Local\Programs\Swift\Toolchains\*\usr\bin\swiftc.exe",
        r"C:\Program Files\Swift\Toolchains\*\usr\bin\swiftc.exe",
        r"C:\Library\Developer\Toolchains\*\usr\bin\swiftc.exe",
        r"C:\Users\*\AppData\Local\Programs\Swift\Runtimes\*\usr\bin\swiftc.exe",
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    return None


def _latest(pattern: str) -> str | None:
    hits = sorted(glob.glob(pattern))
    return hits[-1] if hits else None


def build_env(swiftc: str) -> dict:
    """Swift on Windows 需要三样东西才能编译 + 运行：

      * SDKROOT      = Swift 自带的 Windows 平台 SDK（里面是 Swift 标准库 .swiftmodule）
      * INCLUDE/LIB  = MSVC + Windows SDK（C 头文件与 CRT/系统导入库，否则 <stdlib.h> 找不到）
      * PATH         = 工具链 bin（链接器/运行时）与 Runtimes bin（Foundation.dll 等）

    任何一项缺失都会表现为 `unable to load standard library` 或 `<stdlib.h> file not found`
    或运行期 0xC0000135（找不到 DLL）。这里全部自动探测。
    """
    env = dict(os.environ)
    toolchain_root = os.path.dirname(os.path.dirname(os.path.dirname(swiftc)))  # .../Toolchains/6.4.2+Asserts
    swift_install = os.path.dirname(os.path.dirname(toolchain_root))            # .../Programs/Swift

    platform_sdk = _latest(os.path.join(swift_install, "Platforms", "*", "Windows.platform",
                                        "Developer", "SDKs", "Windows.sdk"))
    if platform_sdk:
        env["SDKROOT"] = platform_sdk

    msvc = _latest(r"C:\Program Files (x86)\Microsoft Visual Studio\*\BuildTools\VC\Tools\MSVC\*") \
        or _latest(r"C:\Program Files\Microsoft Visual Studio\*\BuildTools\VC\Tools\MSVC\*")
    sdk_ver_include = _latest(r"C:\Program Files (x86)\Windows Kits\10\Include\*")
    sdk_ver_lib = _latest(r"C:\Program Files (x86)\Windows Kits\10\Lib\*")
    if msvc and sdk_ver_include:
        parts = [os.path.join(msvc, "include")]
        for sub in ("ucrt", "shared", "um", "winrt"):
            candidate = os.path.join(sdk_ver_include, sub)
            if os.path.isdir(candidate):
                parts.append(candidate)
        env["INCLUDE"] = ";".join(parts) + ";" + env.get("INCLUDE", "")
    if msvc and sdk_ver_lib:
        parts = [os.path.join(msvc, "lib", "x64")]
        for sub in ("ucrt", "um"):
            candidate = os.path.join(sdk_ver_lib, sub, "x64")
            if os.path.isdir(candidate):
                parts.append(candidate)
        env["LIB"] = ";".join(parts) + ";" + env.get("LIB", "")

    runtime_bin = _latest(os.path.join(swift_install, "Runtimes", "*", "usr", "bin"))
    path_bits = [os.path.join(toolchain_root, "usr", "bin")]
    if runtime_bin:
        path_bits.insert(0, runtime_bin)
    env["Path"] = ";".join(path_bits) + ";" + env.get("Path", "")
    return env


def build_and_run(swiftc: str, sources: list[str], main_source: str, payload: dict) -> dict:
    work = tempfile.mkdtemp(prefix="tt-swift-")
    env = build_env(swiftc)
    try:
        copies = []
        for src in sources:
            dst = os.path.join(work, os.path.basename(src))
            shutil.copy2(src, dst)
            copies.append(dst)
        main_path = os.path.join(work, "main.swift")  # 顶层语句只允许写在 main.swift 里
        with open(main_path, "w", encoding="utf-8") as fh:
            fh.write(main_source)
        exe = os.path.join(work, "probe.exe")
        build = subprocess.run(
            [swiftc, "-swift-version", "5"] + copies + [main_path, "-o", exe],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900,
            env=env,
        )
        if build.returncode != 0:
            raise RuntimeError("swiftc 编译失败：\n%s\n%s" % (build.stdout, build.stderr))
        run = subprocess.run(
            [exe], input=json.dumps(payload, ensure_ascii=False),
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180,
            env=env,
        )
        if run.returncode != 0:
            raise RuntimeError("探测程序退出码 %d（0xC0000135 = 找不到 Swift 运行时 DLL）：%s"
                               % (run.returncode, run.stderr))
        return {"build_log": build.stderr.strip(), "output": json.loads(run.stdout)}
    finally:
        shutil.rmtree(work, ignore_errors=True)


LITERAL_MAIN = r"""
import Foundation

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let cases = root["cases"] as? [[String: String]] else {
    FileHandle.standardError.write(Data("bad input".utf8))
    exit(2)
}
var out: [[String: Any]] = []
for item in cases {
    var map: [String: String] = [:]
    map[item["k"] ?? ""] = item["v"] ?? ""
    if let extra = item["k2"], let v2 = item["v2"] {
        map[extra] = v2
    }
    out.append(["k": item["k"] ?? "", "literal": JSLiteral.object(map)])
}
let result: [String: Any] = ["cases": out]
let encoded = (try? JSONSerialization.data(withJSONObject: result)) ?? Data()
FileHandle.standardOutput.write(encoded)
"""

MERGER_MAIN = r"""
import Foundation

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let frames = root["frames"] as? [[[String: Any]]] else {
    FileHandle.standardError.write(Data("bad input".utf8))
    exit(2)
}
var merger = CourseMerger()
var frameChanged: [Int] = []
for frame in frames {
    var changed = 0
    for course in frame {
        if merger.merge(course) { changed += 1 }
    }
    frameChanged.append(changed)
}
var names: [String] = []
var weeks: [String: [Int]] = [:]
var rooms: [String: String] = [:]
for course in merger.courses {
    let name = course["name"] as? String ?? ""
    names.append(name)
    weeks[name] = (course["weeks"] as? [Int]) ?? []
    rooms[name] = course["room"] as? String ?? ""
}
let result: [String: Any] = [
    "frameChanged": frameChanged,
    "count": merger.count,
    "names": names,
    "weeks": weeks,
    "rooms": rooms
]
FileHandle.standardOutput.write((try? JSONSerialization.data(withJSONObject: result)) ?? Data())
"""

STORE_MAIN = r"""
import Foundation

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let steps = root["steps"] as? [[String]],
      let path = root["path"] as? String else {
    FileHandle.standardError.write(Data("bad input".utf8))
    exit(2)
}
var limits = WebStoreFile.Limits()
if let l = root["limits"] as? [String: Any] {
    if let v = l["maxKeyBytes"] as? Int { limits.maxKeyBytes = v }
    if let v = l["maxValueBytes"] as? Int { limits.maxValueBytes = v }
    if let v = l["maxTotalBytes"] as? Int { limits.maxTotalBytes = v }
    if let v = l["maxKeys"] as? Int { limits.maxKeys = v }
    limits.writeDelay = 0.01
}
let url = URL(fileURLWithPath: path)
let store = WebStoreFile(fileURL: url, limits: limits)
for step in steps {
    guard !step.isEmpty else { continue }
    switch step[0] {
    case "set":
        if step.count >= 3 { store.set(step[2], for: step[1]) }
    case "del":
        if step.count >= 2 { store.remove(step[1]) }
    case "clear":
        store.clear()
    case "flush":
        store.flush()
    default:
        break
    }
}

let snapshot = store.snapshot()
let reloaded = WebStoreFile(fileURL: url, limits: limits).snapshot()
let fileData = (try? Data(contentsOf: url)) ?? Data()
var parsedAsObject = false
if let object = try? JSONSerialization.jsonObject(with: fileData) {
    parsedAsObject = object is [String: Any]
}
let out: [String: Any] = [
    "snapshot": snapshot,
    "reloaded": reloaded,
    "fileBytes": fileData.count,
    "fileParsed": parsedAsObject
]
FileHandle.standardOutput.write((try? JSONSerialization.data(withJSONObject: out)) ?? Data())
"""

PATH_MAIN = r"""
import Foundation

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let cases = root["cases"] as? [[String: String]] else {
    FileHandle.standardError.write(Data("bad input".utf8))
    exit(2)
}
var out: [[String: Any]] = []
for item in cases {
    let rootURL = URL(fileURLWithPath: item["root"] ?? "")
    let resolved = WebAssetPath.resolve(root: rootURL, target: item["target"] ?? "")
    out.append([
        "target": item["target"] ?? "",
        "ok": resolved != nil,
        "path": resolved?.path ?? "",
        "mime": WebAssetPath.mimeType(forExtension: resolved?.pathExtension ?? ""),
        "methodOK": WebAssetPath.methodAllowed(item["method"] ?? "GET")
    ])
}
let result: [String: Any] = ["cases": out]
FileHandle.standardOutput.write((try? JSONSerialization.data(withJSONObject: result)) ?? Data())
"""


TRICKY = [
    ("quote", 'he said "hi"'),
    ("backslash", r"C:\Users\能猫\课表.xlsx"),
    ("newline", "第一行\n第二行"),
    ("tab-cr", "a\tb\rc"),
    ("nul", "a\x00b"),
    ("ctrl", "\x01\x1f"),
    ("ls-ps", "line\u2028para\u2029graph"),
    ("unicode", "高等数学 · 周六 · A101"),
    ("emoji", "熊猫🐼课表"),
    ("script-tag", "</script><img src=x onerror=alert(1)>"),
    ("backtick", "`${1+1}`"),
    ("json-ish", '{"a":1,"b":[2,3]}'),
]


def test_literal(swiftc: str) -> None:
    cases = [{"k": name, "v": value} for name, value in TRICKY]
    cases.append({"k": 'key "quoted"', "v": "v", "k2": "k2", "v2": "second"})
    proc = build_and_run(swiftc, [os.path.join(APP_DIR, "JSLiteral.swift")], LITERAL_MAIN, {"cases": cases})
    record("swift:JSLiteral-compiles", True, proc["build_log"][:200] or None)

    for returned in proc["output"]["cases"]:
        literal = returned["literal"]
        expected_value = next((v for k, v in TRICKY if k == returned["k"]), None)
        try:
            parsed = json.loads(literal)
        except Exception as exc:  # noqa: BLE001
            record("swift:JSLiteral-json:%s" % returned["k"], False, "%s -> %s" % (exc, literal[:120]))
            continue
        if expected_value is None:
            ok = parsed.get('key "quoted"') == "v" and parsed.get("k2") == "second"
        else:
            ok = parsed.get(returned["k"]) == expected_value
        record("swift:JSLiteral-json:%s" % returned["k"], ok,
               None if ok else {"literal": literal[:160], "parsed": parsed})

    # 空字典
    empty = build_and_run(swiftc, [os.path.join(APP_DIR, "JSLiteral.swift")], LITERAL_MAIN, {"cases": []})
    record("swift:JSLiteral-empty", empty["output"]["cases"] == [], empty["output"])


def test_paths(swiftc: str) -> None:
    root = os.path.join(tempfile.gettempdir(), "tt-webroot")
    good = [
        ("/", True, "index.html"),
        ("", True, "index.html"),
        ("/index.html", True, "index.html"),
        ("/app.js", True, "app.js"),
        ("/icons/icon-192.png", True, "icon-192.png"),
        ("/app.css?v=3", True, "app.css"),
        ("/index.html#top", True, "index.html"),
        ("/vendor/xlsx.full.min.js", True, "xlsx.full.min.js"),
        ("/sub/", True, "index.html"),
        ("/%69ndex.html", True, "index.html"),
    ]
    bad = [
        "/../etc/passwd",
        "/..%2fetc/passwd",
        "/%2e%2e/%2e%2e/etc/passwd",
        "/a/../../secret.txt",
        "\\windows\\system32\\config",
        "/a\\b.txt",
        "/x%00y.txt",
    ]
    cases = [{"root": root, "target": t} for t, _, _ in good] + [{"root": root, "target": t} for t in bad]
    cases += [{"root": root, "target": "/app.js", "method": m} for m in ("GET", "HEAD", "POST", "delete")]
    proc = build_and_run(swiftc, [os.path.join(APP_DIR, "WebAssetPath.swift")], PATH_MAIN, {"cases": cases})
    record("swift:WebAssetPath-compiles", True, proc["build_log"][:200] or None)

    returned = proc["output"]["cases"]
    for i, (target, expect_ok, suffix) in enumerate(good):
        item = returned[i]
        ok = item["ok"] is expect_ok and item["path"].replace("\\", "/").endswith(suffix)
        record("swift:path-good:%s" % (target or "(empty)"), ok, None if ok else item)

    offset = len(good)
    for i, target in enumerate(bad):
        item = returned[offset + i]
        record("swift:path-traversal:%s" % target, item["ok"] is False, None if item["ok"] is False else item)

    method_base = offset + len(bad)
    allowed = {item["methodOK"] for item in returned[method_base:method_base + 2]}
    record("swift:method-get-head-allowed", allowed == {True}, returned[method_base:method_base + 2])
    denied = [item["methodOK"] for item in returned[method_base + 2:method_base + 4]]
    record("swift:method-post-delete-denied", denied == [False, False], denied)

    mime_expect = {
        "app.js": "application/javascript; charset=utf-8",
        "app.css": "text/css; charset=utf-8",
        "icon-192.png": "image/png",
        "xlsx.full.min.js": "application/javascript; charset=utf-8",
        "index.html": "text/html; charset=utf-8",
    }
    seen = {}
    for item in returned:
        name = item["path"].replace("\\", "/").rsplit("/", 1)[-1]
        if name in mime_expect:
            seen[name] = item["mime"]
    ok = all(seen.get(k) == v for k, v in mime_expect.items())
    record("swift:mime-map", ok, None if ok else seen)


def test_merger(swiftc: str) -> None:
    source = os.path.join(APP_DIR, "CourseMerger.swift")

    def course(**kw):
        base = {"name": "高等数学", "teacher": "张三", "room": "A101", "day": 1,
                "startPeriod": 1, "endPeriod": 2, "weeks": [1, 2]}
        base.update(kw)
        return base

    scenarios = [
        ("two-distinct", [[course(), course(name="大学英语", room="B202", day=2, startPeriod=3, endPeriod=4)]],
         {"count": 2, "frameChanged": [2], "names": ["高等数学", "大学英语"]}),
        ("week-union-across-frames",
         [[course(weeks=[1, 2])], [course(weeks=[2, 3]), course(name="大学英语")]],
         {"count": 2, "frameChanged": [1, 2], "weeks": {"高等数学": [1, 2, 3], "大学英语": [1, 2]}}),
        ("duplicate-same-weeks",
         [[course(weeks=[1, 2])], [course(weeks=[1, 2])]],
         {"count": 1, "frameChanged": [1, 0], "weeks": {"高等数学": [1, 2]}}),
        ("missing-name-dropped",
         [[{"teacher": "张三", "day": 1, "weeks": [1]}]],
         {"count": 0, "frameChanged": [0]}),
        ("weeks-as-strings-and-floats",
         [[course(weeks=["1", "3", 2.0])]],
         {"count": 1, "weeks": {"高等数学": [1, 2, 3]}}),
        ("weeks-out-of-range-filtered",
         [[course(weeks=[0, 1, 61, -3, 20])]],
         {"count": 1, "weeks": {"高等数学": [1, 20]}}),
        ("room-differs-kept-separate",
         [[course(), course(room="A102")]],
         {"count": 2, "frameChanged": [2]}),
        ("string-numbers-dedupe-with-int",
         [[course(day=1, startPeriod=1)], [course(day="1", startPeriod="1", weeks=[5])]],
         {"count": 1, "frameChanged": [1, 1], "weeks": {"高等数学": [1, 2, 5]}}),
        ("single-number-weeks-tolerated",
         [[course(weeks=7)]],
         {"count": 1, "weeks": {"高等数学": [7]}}),
        ("empty-weeks-kept-once",
         [[course(weeks=[])], [course(weeks=[])]],
         {"count": 1, "frameChanged": [1, 0], "weeks": {"高等数学": []}}),
    ]

    for label, frames, expect in scenarios:
        proc = build_and_run(swiftc, [source], MERGER_MAIN, {"frames": frames})
        out = proc["output"]
        problems = []
        for key, want in expect.items():
            got = out.get(key)
            if got != want:
                problems.append("%s: 期望 %r 实际 %r" % (key, want, got))
        record("swift:merger:%s" % label, not problems, problems or None)


def test_store_file(swiftc: str) -> None:
    source = os.path.join(APP_DIR, "WebStoreFile.swift")

    def run(steps, limits=None, prewrite=None):
        work = tempfile.mkdtemp(prefix="tt-store-")
        try:
            path = os.path.join(work, "webstore.json")
            if prewrite is not None:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(prewrite)
            payload = {"path": path, "steps": steps}
            if limits:
                payload["limits"] = limits
            return build_and_run(swiftc, [source], STORE_MAIN, payload)["output"]
        finally:
            shutil.rmtree(work, ignore_errors=True)

    out = run([["set", "tt.data.v1", '{"blocks":[1,2]}'], ["flush"]])
    record("swift:store:roundtrip", out["snapshot"].get("tt.data.v1") == '{"blocks":[1,2]}', out["snapshot"])
    record("swift:store:reload-from-disk", out["reloaded"].get("tt.data.v1") == '{"blocks":[1,2]}', out["reloaded"])
    record("swift:store:atomic-json", out["fileParsed"] is True, out["fileBytes"])

    out = run([["set", "a", "1"], ["set", "a", "2"], ["flush"]])
    record("swift:store:overwrite", out["snapshot"].get("a") == "2", out["snapshot"])

    out = run([["set", "a", "1"], ["flush"], ["del", "a"], ["flush"]])
    record("swift:store:delete", "a" not in out["snapshot"] and "a" not in out["reloaded"], out)

    out = run([["set", "a", "1"], ["set", "b", "2"], ["flush"], ["clear"], ["flush"]])
    record("swift:store:clear", out["snapshot"] == {} and out["reloaded"] == {}, out)

    out = run([["set", "a", "0123456789"], ["flush"]], limits={"maxValueBytes": 8})
    record("swift:store:value-too-big-rejected", "a" not in out["snapshot"], out["snapshot"])

    out = run([["set", "0123456789", "v"], ["flush"]], limits={"maxKeyBytes": 8})
    record("swift:store:key-too-big-rejected", out["snapshot"] == {}, out["snapshot"])

    out = run([["set", "a", "1"], ["set", "b", "2"], ["set", "c", "3"], ["flush"]], limits={"maxKeys": 2})
    record("swift:store:key-count-capped", sorted(out["snapshot"]) == ["a", "b"], out["snapshot"])

    out = run([["set", "a", "12345"], ["set", "b", "12345"], ["set", "c", "x"], ["flush"]],
              limits={"maxTotalBytes": 13})
    record("swift:store:total-capped-keeps-old",
           out["snapshot"].get("a") == "12345" and out["snapshot"].get("b") == "12345" and "c" not in out["snapshot"],
           out["snapshot"])

    out = run([["set", "课程", "🐼高等数学"], ["flush"]])
    record("swift:store:unicode", out["reloaded"].get("课程") == "🐼高等数学", out["reloaded"])

    out = run([["flush"]], prewrite="这不是 JSON{{{")
    record("swift:store:corrupt-file-survives", out["snapshot"] == {} and out["reloaded"] == {}, out)

    out = run([["flush"]], prewrite='["not","a","dict"]')
    record("swift:store:wrong-shape-survives", out["snapshot"] == {}, out)


def main() -> int:
    swiftc = find_swiftc()
    if not swiftc:
        print("跳过 Swift 单测：找不到 swiftc。")
        print("安装：winget install --id Swift.Toolchain --exact")
        return 0
    print("使用编译器: %s" % swiftc)
    test_literal(swiftc)
    test_paths(swiftc)
    test_merger(swiftc)
    test_store_file(swiftc)

    failed = [r for r in results if not r["pass"]]
    print()
    for r in results:
        mark = "PASS" if r["pass"] else "FAIL"
        line = "  [%s] %s" % (mark, r["name"])
        if r["detail"] is not None:
            line += "  <- %s" % (json.dumps(r["detail"], ensure_ascii=False)[:200],)
        print(line)
    print("\nSwift 单测 %d 项，通过 %d 项，失败 %d 项"
          % (len(results), len(results) - len(failed), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())