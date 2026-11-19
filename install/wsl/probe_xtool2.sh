#!/usr/bin/env bash
XT=/opt/xtool/xtool-x86_64.AppImage
if [ -x /opt/xtool/squashfs-root/AppRun ]; then XT=/opt/xtool/squashfs-root/AppRun; fi

echo "##### sdk status"
$XT sdk status 2>&1 | head -20
echo "##### sdk install --help"
$XT sdk install --help 2>&1 | head -30
echo "##### dev build --help"
$XT dev build --help 2>&1 | head -40
echo "##### dev generate-xcode-project --help"
$XT dev generate-xcode-project --help 2>&1 | head -20