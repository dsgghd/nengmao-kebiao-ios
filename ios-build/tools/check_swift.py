#!/usr/bin/env python3
"""用 tree-sitter 的 Swift 语法树检查 Swift 源码的语法错误。

Windows 上没有 Swift 编译器，也没有 UIKit SDK，所以没法类型检查；但语法解析是可行的，
能抓到括号不配对、原始字符串没闭合、关键字拼错、`guard` 缺 `else` 这类会让 Xcode 直接
报错的问题。解析器装在 .tools-py/（pip --target），没有安装时会提示。

用法: python tools/check_swift.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
VENDOR = os.path.join(IOS_BUILD, ".tools-py")


def load_parser():
    if os.path.isdir(VENDOR):
        sys.path.insert(0, VENDOR)
    try:
        from tree_sitter import Language, Parser  # noqa: PLC0415
        import tree_sitter_swift  # noqa: PLC0415
    except Exception as exc:  # noqa: BLE001
        print("跳过 Swift 语法检查：没装 tree-sitter（%s）" % exc)
        print("安装：python -m pip install --target .tools-py tree_sitter tree_sitter_swift")
        return None
    language = Language(tree_sitter_swift.language())
    return Parser(language)


def walk(node, out: list, source: bytes) -> None:
    if node.type == "ERROR" or node.is_missing:
        line = node.start_point[0] + 1
        col = node.start_point[1] + 1
        snippet = source[node.start_byte:node.end_byte].decode("utf-8", "replace")
        snippet = " ".join(snippet.split())[:120]
        out.append((line, col, node.type, snippet))
    for child in node.children:
        walk(child, out, source)


def check_selector_targets(sources: dict[str, str]) -> list[str]:
    """`#selector(x)` 的目标必须真的存在。

    类型检查时因为没有 Objective-C 运行时，`#selector` 被降级成占位调用，
    “方法名是否存在”这一项检查就丢了。这里用文本层面把它补回来：
    把全工程的 `func 名字` 收集起来，任何 `#selector(名字)` 找不到同名 func 就报错。
    """
    import re

    funcs: set[str] = set()
    for text in sources.values():
        funcs.update(re.findall(r"\bfunc\s+([A-Za-z_][A-Za-z0-9_]*)", text))
        # 属性 getter 也可以做 selector（例如 #selector(getter: x)），这里只处理无 label 形式
    problems = []
    pattern = re.compile(r"#selector\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)")
    for name, text in sources.items():
        for match in pattern.finditer(text):
            target = match.group(1)
            if target not in funcs:
                line = text[:match.start()].count("\n") + 1
                problems.append("%s:%d #selector(%s) 找不到同名 func" % (name, line, target))
    return problems


def main() -> int:
    parser = load_parser()
    if parser is None:
        return 0

    files = sorted(f for f in os.listdir(APP_DIR) if f.endswith(".swift"))
    if not files:
        print("没有找到 Swift 文件")
        return 1

    total_errors = 0
    sources: dict[str, str] = {}
    for name in files:
        path = os.path.join(APP_DIR, name)
        with open(path, "rb") as fh:
            source = fh.read()
        sources[name] = source.decode("utf-8", "replace")
        tree = parser.parse(source)
        problems: list = []
        walk(tree.root_node, problems, source)
        if problems:
            total_errors += len(problems)
            print("%s: %d 处语法问题" % (name, len(problems)))
            for line, col, kind, snippet in problems[:10]:
                print("  %s:%d:%d %s  %s" % (name, line, col, kind, snippet))
        else:
            lines = source.count(b"\n") + 1
            print("%s: 语法解析通过（%d 行）" % (name, lines))

    selector_problems = check_selector_targets(sources)
    if selector_problems:
        total_errors += len(selector_problems)
        print("\n#selector 目标检查失败：")
        for problem in selector_problems:
            print("  " + problem)
    else:
        print("\n#selector 目标检查通过（所有 selector 都能找到同名 func）")

    print()
    if total_errors:
        print("Swift 检查失败：%d 处" % total_errors)
        return 1
    print("Swift 检查通过（%d 个文件）。注意：这是语法 + selector 目标检查，类型检查见 tools/swift_typecheck.py。" % len(files))
    return 0


if __name__ == "__main__":
    sys.exit(main())