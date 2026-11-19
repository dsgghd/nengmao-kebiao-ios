#!/usr/bin/env python3
"""生成 iOS 资源目录 Assets.xcassets（AppIcon / AccentColor / Launch）。

用法（Windows 上已可运行，只依赖 Pillow）:
    python tools/make_assets.py [--check]

--check 只校验已生成的资源，不写文件；校验项：
  * 每个 Contents.json 都能解析、filename 指向的文件存在
  * 每张 AppIcon 的像素尺寸与 Contents.json 声明的 size*scale 一致
  * AppIcon 全部为不透明（无 alpha 通道、无 tRNS），App Store 会拒绝带 alpha 的 1024 图标
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
ASSETS = os.path.join(IOS_BUILD, "NengmaoKeBiao", "Assets.xcassets")

BRAND_DIRS = [
    os.path.join(os.path.dirname(IOS_BUILD), "assets", "brand"),
    os.path.join(IOS_BUILD, "..", "assets", "brand"),
]

ICON_SOURCE = "logo-nengmao-grin-1024.png"

# (idiom, size_pt, scale, filename)
APPICONS = [
    ("iphone", "20x20", "2x", "AppIcon-20@2x.png"),
    ("iphone", "20x20", "3x", "AppIcon-20@3x.png"),
    ("iphone", "29x29", "2x", "AppIcon-29@2x.png"),
    ("iphone", "29x29", "3x", "AppIcon-29@3x.png"),
    ("iphone", "40x40", "2x", "AppIcon-40@2x.png"),
    ("iphone", "40x40", "3x", "AppIcon-40@3x.png"),
    ("iphone", "60x60", "2x", "AppIcon-60@2x.png"),
    ("iphone", "60x60", "3x", "AppIcon-60@3x.png"),
    ("ios-marketing", "1024x1024", "1x", "AppIcon-1024.png"),
]

LAUNCH_IMAGES = [("1x", "LaunchImage.png", 128),
                 ("2x", "LaunchImage@2x.png", 256),
                 ("3x", "LaunchImage@3x.png", 384)]

ACCENT_RED = "0xD33228"
PAPER = "0xF2EEE3"


def brand_source(name: str) -> str:
    for d in BRAND_DIRS:
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    raise SystemExit("找不到品牌图: %s" % name)


def write_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def flatten(im: Image.Image, size: int) -> Image.Image:
    """统一转成不透明 RGB 并缩放；App Store 不接受带 alpha 的图标。"""
    im = im.convert("RGB")
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return im


def build_assets() -> None:
    src = Image.open(brand_source(ICON_SOURCE))
    root_contents = {"info": {"author": "xcode", "version": 1}}

    # 1. AppIcon
    icon_dir = os.path.join(ASSETS, "AppIcon.appiconset")
    os.makedirs(icon_dir, exist_ok=True)
    images = []
    for idiom, size_pt, scale, filename in APPICONS:
        px = int(float(size_pt.split("x")[0]) * int(scale[0]))
        flatten(src, px).save(os.path.join(icon_dir, filename), "PNG", optimize=True)
        images.append({"filename": filename, "idiom": idiom, "scale": scale, "size": size_pt})
    write_json(os.path.join(icon_dir, "Contents.json"),
               {"images": images, "info": {"author": "xcode", "version": 1}})

    # 2. AccentColor
    write_json(os.path.join(ASSETS, "AccentColor.colorset", "Contents.json"), {
        "colors": [{
            "color": {
                "color-space": "srgb",
                "components": {"alpha": "1.000", "blue": "0x28", "green": "0x32", "red": "0xD3"},
            },
            "idiom": "universal",
        }],
        "info": {"author": "xcode", "version": 1},
    })

    # 3. 启动屏底色（与网页 paper 一致，避免启动瞬间白闪）
    write_json(os.path.join(ASSETS, "LaunchBackground.colorset", "Contents.json"), {
        "colors": [{
            "color": {
                "color-space": "srgb",
                "components": {"alpha": "1.000", "blue": "0xE3", "green": "0xEE", "red": "0xF2"},
            },
            "idiom": "universal",
        }],
        "info": {"author": "xcode", "version": 1},
    })

    # 4. 启动图（居中熊猫头）
    launch_dir = os.path.join(ASSETS, "LaunchImage.imageset")
    os.makedirs(launch_dir, exist_ok=True)
    launch_images = []
    for scale, filename, px in LAUNCH_IMAGES:
        flatten(src, px).save(os.path.join(launch_dir, filename), "PNG", optimize=True)
        entry = {"filename": filename, "idiom": "universal", "scale": scale}
        if scale == "1x":
            entry["orientation"] = "portrait"
        launch_images.append(entry)
    write_json(os.path.join(launch_dir, "Contents.json"),
               {"images": launch_images, "info": {"author": "xcode", "version": 1}})

    write_json(os.path.join(ASSETS, "Contents.json"), root_contents)
    print("已生成 %s" % ASSETS)
    for idiom, size_pt, scale, filename in APPICONS:
        px = int(float(size_pt.split("x")[0]) * int(scale[0]))
        print("  AppIcon %-14s %s  %dx%d" % (size_pt, scale, px, px))


def check_assets() -> int:
    problems = []

    def load(path):
        try:
            with open(path, encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as exc:  # noqa: BLE001
            problems.append("%s: 无法解析 Contents.json (%s)" % (path, exc))
            return None

    sets = ["AppIcon.appiconset", "AccentColor.colorset", "LaunchBackground.colorset", "LaunchImage.imageset"]
    root = os.path.join(ASSETS, "Contents.json")
    if not os.path.isfile(root):
        problems.append("缺少 Assets.xcassets/Contents.json")
    for name in sets:
        contents = os.path.join(ASSETS, name, "Contents.json")
        if not os.path.isfile(contents):
            problems.append("缺少 %s/Contents.json" % name)
            continue
        data = load(contents)
        if data is None:
            continue
        for entry in data.get("images", []) + data.get("colors", []):
            fn = entry.get("filename")
            if not fn:
                continue
            path = os.path.join(ASSETS, name, fn)
            if not os.path.isfile(path):
                problems.append("%s: 记录的文件不存在 %s" % (name, fn))
                continue
            if name != "AppIcon.appiconset":
                continue
            want = int(float(entry["size"].split("x")[0]) * int(entry["scale"][0]))
            im = Image.open(path)
            if im.size != (want, want):
                problems.append("%s: %s 尺寸 %s != 期望 %dx%d" % (name, fn, im.size, want, want))
            if im.mode != "RGB" or "transparency" in im.info:
                problems.append("%s: %s 带 alpha (mode=%s)，App Store 会拒绝" % (name, fn, im.mode))

    if problems:
        print("资源校验失败：")
        for p in problems:
            print("  - " + p)
        return 1
    print("资源校验通过：%d 套资源，图标全部不透明且尺寸匹配" % len(sets))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if not args.check:
        build_assets()
    return check_assets()


if __name__ == "__main__":
    sys.exit(main())