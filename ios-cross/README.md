# 在 Windows 上做 iOS 安装包：能做到哪一步，卡在哪

这个目录是为了回答一个具体问题：**没有 Mac，能不能造出一个能装到 iPhone 上的 App 包？**

结论先说：**这台机器上造不出能安装的 .ipa**。卡点不是"不会写"，是链接器。下面是实测证据和唯一可行的收尾方式。

---

## 1. 已经做到的（真编译，不是模拟）

Windows 上的 Swift 6.4.2 工具链自带 clang 21 + `ld64.lld`。我用它**真的编译出了 arm64 / iOS 目标文件**：

```powershell
clang -target arm64-apple-ios15.0 -isysroot <iPhoneOS15.6.sdk> `
      -fobjc-runtime=ios-15.0 -fno-objc-arc -O2 -c shell.m -o shell.o
# exit 0 → shell.o 是 Mach-O arm64 目标文件
```

`shell.m` 就是本目录那份：**不 include 任何 SDK 头文件**，把用到的东西（`objc_msgSend`、`UIApplicationMain`、`CGRect`…）自己声明一遍，运行时用 `objc_allocateClassPair` 现造 AppDelegate，再建 UIWindow + WKWebView 加载 `Web/index.html`。这条路本来能绕开 "Windows 没有 iPhoneOS SDK 头文件" 和 "没有 Swift 的 iOS 标准库"。

SDK 链接桩也备齐了（`iPhoneOS15.6.sdk`，来自 GitHub 镜像）：
`libSystem.B.tbd`、`UIKit.tbd`、`WebKit.tbd`、`Foundation.tbd`、`CoreGraphics.tbd`、`CoreFoundation.tbd`、`QuartzCore.tbd`。

## 2. 卡点：链接器不认 iOS

```
$ ld64.lld -arch arm64 -platform_version ios 15.0 15.0 ... 
ld64.lld: error: This version of lld does not support linking for platform iOS
```

`ld64.lld --help` 的说明里确实列了 `ios`，但 LLVM 的 Mach-O 链接器目前**只实现 macOS**（`lld/MachO/Driver.cpp` 里对非 macOS 平台直接报这条错）。所以：目标文件有了，可执行文件生成不了。没有可执行文件，`.app` 里就没有主二进制，IPA 无从谈起。

我把其他出口也试了一遍，都没有：

| 出口 | 结果 |
| --- | --- |
| clang 驱动 `-fuse-ld=lld -platform_version ios` | 同一个错误（驱动把参数传给 `ld64.lld`） |
| 换 `ld.lld` / `lld-link` | 那是 ELF / PE 链接器，不产出 Mach-O |
| cctools-port（Apple `ld64` 的移植版，支持 iOS） | GitHub 上没有 Windows 构建；源码要 Linux/macOS 编译 |
| Docker 跑 Linux 链接器 | 本机无 Docker |
| WSL 跑 Linux 链接器 | 无发行版；且 `HypervisorPresent = False`（虚拟化未开），WSL2 起不来 |
| Swift 直接编 iOS | Windows 工具链只带 Windows/Android 平台，**没有 iOS 的 Swift 标准库** |

## 3. 要在哪台机器上收尾（都是一条命令的事）

`ios-cross/` 里的 `shell.m` 和装配脚本可以直接用，只差一个能链 iOS 的链接器。

**A. 有 Mac（最省事，但直接用 Xcode 工程更好）**

```bash
cd ios-build && ./scripts/build.sh simulator     # 先确认能编译
open NengmaoKeBiao.xcodeproj                     # 选 Team → Archive → 导出 IPA
```

**B. 有 Linux（VPS 就行，不需要 Apple 机器）**

```bash
# 装 theos 工具链（含能链 iOS 的 ld64）
bash -c "$(curl -fsSL https://raw.githubusercontent.com/theos/theos/master/bin/install-theos)"
git clone https://github.com/theos/sdks ~/theos/sdks   # 或复用本目录的 iPhoneOS15.6.sdk
export THEOS=~/theos

# 用本目录的 shell.m + 已备好的 SDK 链接
$THEOS/toolchain/linux/iphone/bin/clang -target arm64-apple-ios15.0 \
    -isysroot ~/theos/sdks/iPhoneOS15.6.sdk -fobjc-runtime=ios-15.0 -fno-objc-arc \
    -c shell.m -o shell.o
# 再用 theos 自带的 ld64 链接（不是 lld），产出 NengmaoKeBiao
```

**C. 推到 GitHub，用 Actions 的 macOS runner**（`.github/workflows/ios-build.yml` 已经写好在仓库根）
编译成功后 artifact 里就有 `.app`；要 IPA 再走 `scripts/build.sh archive` 那一步。

## 4. 不想折腾的话：WebClip 已经能装

`install/能猫课表.mobileconfig` —— 装描述文件，桌面出现全屏图标，**且实测可离线**（线上版 Service Worker 缓存为 `timetable-v42`，断网重载仍能打开）。它没有自动导入和原生提醒，但"像个 App 一样在桌面上打开"这件事已经成立。

---

### 复现上面的结论

```powershell
# 1) 取 SDK 链接桩（脚本见 README 里的下载逻辑，或复用 %USERPROFILE%\sdks\iPhoneOS15.6.sdk）
# 2) 编目标文件
clang -target arm64-apple-ios15.0 -isysroot <SDK> -fobjc-runtime=ios-15.0 -fno-objc-arc -c shell.m -o shell.o
# 3) 链接（这里会失败，就是本文的证据）
ld64.lld -arch arm64 -platform_version ios 15.0 15.0 -syslibroot <SDK> -o NengmaoKeBiao shell.o -framework UIKit
```