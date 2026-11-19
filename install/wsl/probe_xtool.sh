#!/usr/bin/env bash
# 探测 xtool 各子命令参数（在 WSL 里跑）
XT=/opt/xtool/xtool-x86_64.AppImage
if [ -x /opt/xtool/squashfs-root/AppRun ]; then XT=/opt/xtool/squashfs-root/AppRun; fi

echo "##### XT=$XT"
echo "##### setup --help"
$XT setup --help 2>&1 | head -40
echo "##### sdk --help"
$XT sdk --help 2>&1 | head -40
echo "##### dev --help"
$XT dev --help 2>&1 | head -60
echo "##### auth --help"
$XT auth --help 2>&1 | head -30