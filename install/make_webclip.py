#!/usr/bin/env python3
"""生成“能猫课表”的 iPhone 安装包（不需要 Apple 签名）。

产出两样东西，都放在 install/ 里：

  1. 能猫课表.mobileconfig —— WebClip 配置描述文件。
     在 iPhone 上点它 → 设置里“已下载描述文件” → 安装，桌面就会出现一个全屏图标。
     这是 iOS 上唯一“点一下文件就装上”的形态（App Store / 自签 IPA 都需要开发者证书）。

  2. nengmao-kebiao-web.zip —— PWA 静态站点（index.html + manifest + sw.js + 图标）。
     丢到任何 https 空间（或局域网起个 http 服务）就能用 Safari 打开，
     再“分享 → 添加到主屏幕”。第二种装法，不依赖描述文件。

用法：
  python install/make_webclip.py                       # 用线上地址（默认）
  python install/make_webclip.py --url http://192.168.1.5:8787/   # 指向自己的局域网/自建服务
  python install/make_webclip.py --url https://x.example/ --no-zip
"""
from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import uuid
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_URL = "https://kebiao-ivoefg6tvfc.qoder.zone/"
LABEL = "能猫课表"

ICON_CANDIDATES = [
    os.path.join(ROOT, "ios-build", "NengmaoKeBiao", "Web", "icons", "icon-512.png"),
    os.path.join(ROOT, "assets", "brand", "logo-nengmao-grin-512.png"),
]

WEB_FILES = [
    "index.html", "manifest.webmanifest", "sw.js",
    "app.css", "app.js", "parser.js", "schools-seed.js", "theme-c3.css",
]
ICON_DIR = os.path.join(ROOT, "ios-build", "NengmaoKeBiao", "Web", "icons")
ICON_FILES = ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon.svg"]

# 这些是“必须一起打包、否则功能会静默坏掉”的文件：
#   vendor/xlsx.full.min.js 负责解析 .xlsx，漏了它导入按钮就报错
EXTRA_FILES = [
    (os.path.join(ROOT, "ios-build", "NengmaoKeBiao", "Web", "vendor", "xlsx.full.min.js"),
     "vendor/xlsx.full.min.js"),
]


def build_mobileconfig(url: str, icon_path: str, out_path: str) -> None:
    with open(icon_path, "rb") as fh:
        icon = fh.read()

    webclip = {
        "PayloadType": "com.apple.webClip.managed",
        "PayloadVersion": 1,
        "PayloadIdentifier": "com.nengmao.kebiao.webclip",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": LABEL,
        "Label": LABEL,
        "URL": url,
        "Icon": icon,
        "FullScreen": True,
        "Precomposed": True,
        "IsRemovable": True,
    }
    profile = {
        "PayloadType": "Configuration",
        "PayloadVersion": 1,
        "PayloadIdentifier": "com.nengmao.kebiao.profile",
        "PayloadUUID": str(uuid.uuid4()).upper(),
        "PayloadDisplayName": LABEL,
        "PayloadDescription": "把能猫课表添加到 iPhone 主屏幕（全屏，像 App 一样打开）",
        "PayloadOrganization": LABEL,
        "PayloadRemovalDisallowed": False,
        "PayloadContent": [webclip],
    }
    with open(out_path, "wb") as fh:
        plistlib.dump(profile, fh)


def build_web_zip(out_path: str) -> list[str]:
    added: list[str] = []
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in WEB_FILES:
            src = os.path.join(ROOT, "dist", name)
            if os.path.isfile(src):
                zf.write(src, name)
                added.append(name)
        for name in ICON_FILES:
            src = os.path.join(ICON_DIR, name)
            if os.path.isfile(src):
                zf.write(src, "icons/" + name)
                added.append("icons/" + name)
        for src, arc in EXTRA_FILES:
            if os.path.isfile(src):
                zf.write(src, arc)
                added.append(arc)
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--no-zip", action="store_true")
    args = ap.parse_args()

    icon = next((p for p in ICON_CANDIDATES if os.path.isfile(p)), None)
    if not icon:
        raise SystemExit("找不到图标文件")

    os.makedirs(HERE, exist_ok=True)
    cfg_path = os.path.join(HERE, LABEL + ".mobileconfig")
    build_mobileconfig(args.url, icon, cfg_path)
    print("描述文件: %s（%d KB，指向 %s）"
          % (cfg_path, os.path.getsize(cfg_path) // 1024, args.url))

    if not args.no_zip:
        zip_path = os.path.join(HERE, "nengmao-kebiao-web.zip")
        files = build_web_zip(zip_path)
        print("网页安装包: %s（%d 个文件，%d KB）"
              % (zip_path, len(files), os.path.getsize(zip_path) // 1024))
        for name in files:
            print("   + " + name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())