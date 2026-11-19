# 用 xtool 把能猫课表编成 iOS App（Linux / WSL）

[xtool](https://github.com/xtool-org/xtool) 是"跨平台 Xcode 替代"：用 SwiftPM 把包编成 iOS App，
自带签名、安装、Apple Developer Services 交互。**它正好补上 Windows 上缺的那个 iOS 链接器**。

## 1. 已经拿到的（可核对的产物）

| 项 | 值 |
| --- | --- |
| 版本 | xtool 1.24.0（2026-10-26 发布） |
| 资产 | `xtool-x86_64.AppImage`，51.6 MB |
| sha256 | `dbfd9d72…dab59f`，**与 GitHub release 里 assets 的 digest 逐字符一致** |
| 本地位置 | `%USERPROFILE%\sdks\xtool\xtool-x86_64.AppImage` |
| 平台 | Linux x86_64 ELF（AppImage） |

release 里只有两种产物：Linux AppImage 和 macOS `.app.zip`。README 写的 "Linux, Windows, and macOS"，
其中 **Windows 是通过 WSL**（它的安装文档就叫 Installation (Linux)）。

**这台机器为什么跑不了它**：`wsl.exe` 在，但没有装任何发行版；`HypervisorPresent = False`
（虚拟化没开），所以 WSL2 起不来；WSL1 需要先开 Windows 功能然后**重启**，这会中断当前会话。
想要在这台机器上直接跑，执行（管理员 PowerShell，然后重启）：

```powershell
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
# 重启后：
wsl --install -d Ubuntu
```

## 2. 本目录是什么

按 xtool 自己的工程约定（`Sources/XToolSupport/NewCommand.swift` 的模板 + `PackSchema.swift` 的
schema + `Packer.swift` 的资源复制实现）把本工程套了进去：

```
install/xtool/
├─ Package.swift       一个 library product；target 直接指向 ../../ios-build/NengmaoKeBiao
├─ xtool.yml           bundleID / infoPath / iconPath / resources
├─ Info.plist          xtool 专用：值写死，不用 $(VAR)，保留 ATS 两条
└─ setup_and_build.sh  Linux 上一条命令：校验 sha256 → xtool setup → xtool dev
```

关键点（都是读 xtool 源码确认的，不是猜）：

- `resources:` 里的路径由 `packFileToRoot` 用 `FileManager.copyItem` 整棵复制到 `.app` 根，
  **目录会保留结构** —— 我们网页靠 `app.css`、`icons/xx.png` 这种相对路径加载，拍平就全 404。
- `xtool.yml` 的合法键：`version / orgID / bundleID / product / infoPath / entitlementsPath /
  iconPath / resources / extensions / skipLSP`，`bundleID` 与 `orgID` 二选一。
- 主 App 必须是**恰好一个 library product**；模板把 `@main` 放在库里的 `App` 结构上。
  我们的 `@main class AppDelegate: UIResponder, UIApplicationDelegate` 属于同一类写法（UIKit 版）。

## 3. 怎么跑

把仓库整体拷到 Linux（或 WSL 的 Ubuntu），然后：

```bash
cd install/xtool
bash setup_and_build.sh
```

脚本会：校验 AppImage 的 sha256 → `xtool setup`（装 Darwin Swift SDK，会要求登录 Apple ID）→
`xtool dev` 编译。产物（`.app` / `.ipa`）路径以 xtool 输出为准。

前置：宿主装好 Swift 6.x（xtool 依赖它）、`curl`；AppImage 需要 FUSE（Ubuntu：`apt install libfuse2`）。

## 4. 还没验证的部分（说清楚，不装作跑过）

1. **UIKit 的 `@main` 在 xtool 下是否直接可用**——模板只演示了 SwiftUI 的 `@main struct App: App`。
   如果不接受，最小改法是把入口换成 SwiftUI 包一层 `UIViewControllerRepresentable`，或按 xtool
   文档改用它的 entry 约定。
2. **xtool 的 Darwin SDK 是否带全 `Network` / `UserNotifications` / `Security`**——我们用了
   `NWListener`、`UNUserNotificationCenter`、`SecTrustEvaluateWithError`。缺哪个就按编译报错收敛，
   或者先砍掉对应模块（本地 HTTP 服务可退化成 file:// 那条路，代码里已有兜底）。
3. **`resources:` 指向工程目录之外（`../../ios-build/...`）**是否被接受——`copyItem` 的路径是相对的
   工作目录，理论上可以；不接受就把 Web/ Scripts/ 复制进本目录再引用。

这三条都只能在 Linux 上跑一次才知道，而本机跑不了。

## 5. 如果你不想碰 Linux

- **有 Mac**：`cd ios-build && ./scripts/build.sh simulator` → `open NengmaoKeBiao.xcodeproj` → Archive
- **推送 GitHub**：仓库根的 `.github/workflows/ios-build.yml` 会在 macOS runner 上编好并核对 `.app` 内容
- **只想马上有个图标能用**：`install/能猫课表.mobileconfig`（WebClip，已实测可离线）