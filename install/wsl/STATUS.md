# WSL 安装状态（2026-11-19 更新：WSL2 已就绪）

## 现在的真实进度

| 环节 | 状态 | 证据 |
| --- | --- | --- |
| WSL 功能 + VirtualMachinePlatform | **已启用并生效** | `HypervisorPresent=True`，`LxssManager` Running |
| Ubuntu 22.04 发行版 | **已导入，且已转成 WSL2** | `wsl -l -v` → `NengmaoLinux  VERSION 2`；`uname -r` → `5.10.16.3-microsoft-standard-WSL2` |
| WSL2 内核包 | 已装（`wsl_update_x64.msi`） | `C:\Windows\System32\lxss\tools\kernel` 70 MB |
| Swift 6.0.3 (Linux) | **能跑** | `swift --version` → `6.0.3 (swift-6.0.3-RELEASE) x86_64-unknown-linux-gnu` |
| 宿主依赖 | 已补齐 | gcc / libgcc-11-dev / libxml2 / libncurses6 / libcurl4 / libsqlite3-0 / binutils / unzip |
| xtool 1.24.0 | **能跑** | `xtool --help` 正常（缺 fusermount 时自动 `--appimage-extract`） |
| xtool 工程 scaffold | **SwiftPM 校验通过** | `swift package dump-package` exit=0：`NengmaoKeBiao` 单 library product、target 指向 `../../ios-build/NengmaoKeBiao`、exclude `Web/Scripts/Assets.xcassets/Info.plist`、platforms iOS 17 / macOS 14 |
| 编译出 .app / .ipa | **卡在 Apple SDK** | `xtool dev build` → `Now generating the Darwin SDK. Error: Could not read file or directory at path ''`；`swift build --triple arm64-apple-ios` → `toolchain is invalid: could not find CLI tool 'libtool'` |

## 唯一剩下的门：Darwin SDK

xtool 源码（`Sources/XToolSupport/SDKCommand.swift`）写死了 SDK 来源：

- `xtool sdk install <path>` 只接受 **`Xcode.xip` / `Xcode.app` / `darwin.xtoolsdk`**
- 提示原文：`Please download Xcode from http://developer.apple.com/download/all/?q=Xcode`
- 也就是 **Apple 账号 + 约 3.5 GB 下载**，这一步没法匿名绕开

### 拿到 Xcode 之后（一条命令）

```powershell
# Windows 上把 Xcode.xip 下到 C:\Users\Administrator\Downloads\Xcode.xip
wsl -d NengmaoLinux -u root -- bash /mnt/c/Users/Administrator/Documents/Qoder/2026-11-16/2b4fcef7/install/wsl/build_with_xcode.sh /mnt/c/Users/Administrator/Downloads/Xcode.xip --slim --ipa
```

或者想要 xtool 直接签好：

```bash
wsl -d NengmaoLinux -u root
/opt/xtool/xtool-x86_64.AppImage auth login      # Apple ID + 2FA
bash /mnt/c/.../install/wsl/build_with_xcode.sh /mnt/c/.../Xcode.xip --slim --ipa --sign
```

只出 `.app` 时用 Sideloadly / AltStore 在 Windows 上用自己的 Apple ID 签名安装（7 天有效）。

## 备选（都不需要 Xcode.xip）

- **Mac**：`cd ios-build && ./scripts/build.sh simulator` → Xcode 打开 → 选 Team → Archive
- **GitHub Actions**：仓库根的 `.github/workflows/ios-build.yml` 在 macOS runner 上编（runner 自带 Xcode）
- **只想马上有图标**：`install/能猫课表.mobileconfig`（WebClip，已实测断网可用）

## 复现我这轮做过的事

```powershell
# 1) 检查 WSL2
wsl -l -v
wsl -d NengmaoLinux -u root -- uname -r

# 2) Swift / xtool 是否就绪
wsl -d NengmaoLinux -u root -- /opt/swift/usr/bin/swift --version
wsl -d NengmaoLinux -u root -- /opt/xtool/xtool-x86_64.AppImage --help

# 3) scaffold 校验（会真正跑 SwiftPM）
wsl -d NengmaoLinux -u root -- bash /mnt/c/.../install/wsl/fix_gcc.sh
```