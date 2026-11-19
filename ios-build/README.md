# 能猫课表 iOS 版（工程说明 / 交接文档）

本地 Web 课表 + WKWebView 校内登录 + 复用安卓版的 EAMS/通用课表解析脚本。

**状态**：工程结构、图标资源、注入脚本、存储落盘、cookie、课表合并、本地服务路径解析都已在 Windows 上**真跑过**；73 个 iOS API 调用点已对照 Apple 头文件核过（含真 Swift 编译器、真 WebKit 引擎、真 EAMS 解析脚本）；10 个 Swift 源文件（2052 行）通过了**真编译器的类型检查**（对自写桩模块）。**仍未用 xcodebuild 编译、没在 iPhone 上运行**——本机没有 macOS/iOS SDK，这一点没变。每一条结论下面都标了证据等级。

---

## 一、验证总览（本机实跑，153 项断言 + 2052 行类型检查）

```bash
python scripts/setup_tools.py      # 一次性装工具（见第三节）
python tools/run_all_checks.py     # 全跑
```

| 关卡 | 工具 | 结果 | 证明了什么 / 没证明什么 |
| --- | --- | --- | --- |
| 资源与图标 | `make_assets.py` | 4 套资源通过 | AppIcon 9 个尺寸与声明一致、无 alpha（App Store 会拦带 alpha 的 1024 图标） |
| 工程结构 | `validate_project.py` + 自写 OpenStep 解析器 | 通过 | pbxproj 语法/引用闭合/无重复 ID、每个 file reference 真存在、`Web`+`Scripts` 是 folder reference、`INFOPLIST_FILE`/BundleID/AppIcon/AccentColor 正确、Info.plist 键齐全，**并核对了源码里每个 `Bundle.main.url(forResource:…)` 引用的资源真的在包里**（防真机白屏）。不证明 Xcode 会接受这份工程 |
| Swift 语法 + selector | `check_swift.py`（tree-sitter） | 10 文件通过 | 语法层面没写错；所有 `#selector(x)` 都能找到同名 `func x` |
| **Swift 类型检查** | `swift_typecheck.py`（Swift 6.4.2 + 自写 AppleStubs） | **10 文件 / 2052 行通过** | 可选值、闭包签名、协议实现、重载选择、属性名这类**代码自身**的错误。桩的签名对不对由下一行兜 |
| **API 审计（Apple 头文件）** | `sdk_api_audit.py`（对照 iPhoneOS SDK 的 ObjC 头文件） | **73/73 调用点通过**（33 个头文件） | 每个被调用的 iOS API 在 Apple 自己的声明里真的存在、选择器/属性名/参数形状对得上。这是把"我记的 API"换成"Apple 写的 API" |
| Swift 真编译单测 | `swift_unit_tests.py`（Swift 6.4.2 + MSVC + Windows SDK） | **59 项通过** | 四个纯 Foundation 模块被真编译、真执行：JS 字面量转义、本地服务路径解析、多帧课程合并、**存储落盘内核** |
| 网页层 · Chromium | `web_layer_tests.py`（headless Edge） | **58 项通过** | 注入脚本逻辑、桥接参数映射、真实 `app.js` 的导入流程 |
| 网页层 · WebKit | `webkit_tests.py`（Playwright WebKit） | **17 项通过**（+2 条环境观测） | 与 Safari/WKWebView 同族引擎下：polyfill 能遮蔽原生 localStorage、镜像不覆盖已有值、app.js 在 JSC 下正常 |
| 端到端 · 注入层 + 真解析脚本 | `import_e2e_tests.py`（WebKit） | **19 项通过** | 真 `eams-scrape.js` 在真注入包装里解析出课程（含 rowspan 展开、单双周、教室/校区），且自动提交**只发生 1 次** |

合计：`59 + 58 + 17 + 19 = 153` 项断言全部通过，另加 2052 行的真类型检查。

### 类型检查是怎么做的（以及它的边界）

Windows 上没有 UIKit/WebKit/Network/UserNotifications/Security，于是：

1. `tools/swift_stubs/Stubs.swift` 把工程用到的这些 API 按 Apple 文档写成桩模块 `AppleStubs`（`UIViewController`、`WKWebView`、`NWListener`、`UNUserNotificationCenter`、`SecTrustEvaluateWithError` 等）。
2. 复制 9 个源文件到临时目录，做**三类声明过的改写**（脚本会打印每处改写数量）：
   - `import UIKit/WebKit/…` → `import Foundation + FoundationNetworking + AppleStubs`
   - Windows 版 Foundation 把 `HTTPCookie/URLCredential/URLAuthenticationChallenge` 砍成 `AnyObject` 占位，换名成桩里的 `T*` 版本（只换名）
   - Windows 没有 Objective-C 运行时：`@objc` 去掉、`#selector(x)` 降级成 `TSelector("x")`
3. `swiftc -typecheck` 全部文件。

**边界**：桩的签名是照文档手写的。所以它证明"代码内部自洽"，不证明"我记的 Apple API 就是 Apple 的 API"。另外 `#selector` 降级会丢掉"被选中的方法是否存在"这一项检查。这两点分别由 `check_swift.py` 的 selector 检查和下面的头文件审计补上。

### API 审计：用 Apple 自己的头文件校对

`tools/sdk_api_audit.py` 拿 iPhoneOS SDK 的 **Objective-C 头文件**当基准（GitHub 镜像
`Phenmod/iPhoneOS.sdk-Headers`，`--fetch` 会按需下载到本地缓存），把工程里 73 个调用点逐个核对：

| 我们的 Swift 写法 | 必须在头文件里找到的 ObjC 声明 |
| --- | --- |
| `webView.callAsyncJavaScript(_:arguments:in:in:completionHandler:)` | `callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:` |
| `store.getAllCookies { … }` | `getAllCookies:…completionHandler:` |
| `URLCredential(trust: trust)` | `initWithTrust:(SecTrustRef)trust` |
| `UNTimeIntervalNotificationTrigger(timeInterval:repeats:)` | `triggerWithTimeInterval:repeats:`（工厂方法，Swift 侧导入成 init） |

匹配前会把注释和空白全部去掉（头文件里声明经常跨行），所以不会被格式噪声误判。

这轮审计直接纠正了我 3 处记错的地方：`credentialWithTrust:` 其实是 `initWithTrust:`；
`getAllCookies` 的 block 参数中间夹了 `WK_SWIFT_UI_ACTOR` 宏；`UNTimeIntervalNotificationTrigger`
只有工厂方法、没有 `initWithTimeInterval:repeats:`。**代码不需要改**（Swift 侧名字本来就是对的），
但如果这些名字记错了又没人核，Mac 上第一次编译就会炸——现在这一类错误被提前消掉了。

**仍然核不动的 6 项**（Swift-native，SDK 里没有 ObjC 头文件）：`NWListener(using:on:)`、
`NWListener.stateUpdateHandler`、`NWConnection.receive`、`NWConnection.send`、
`WKContentWorld.page`、`Data.WritingOptions.completeFileProtectionUntilFirstUserAuthentication`。

**没有覆盖的**（见第七节）：UIKit/WKWebView 类型检查、xcodebuild 编译链接、真机运行、签名、真机 SSO/证书。

---

## 二、这一版的关键改动

### 1. 工程可打开（不再依赖 XcodeGen）

`NengmaoKeBiao.xcodeproj` 是手写 + 校验的：`tools/gen_xcodeproj.py` 按 OpenStep plist 生成 `project.pbxproj` 和共享 scheme，`tools/validate_project.py` 再反向解析校验。`project.yml` 保留但和 pbxproj 必须保持一致（两选一，别同时改）。

### 2. 网页不再是 `file://`（localStorage 才真持久）

```
启动 → LocalWebServer(127.0.0.1, 固定端口 47821~47826)
     → URLSession 探活 GET /index.html
        ├ 200 → http://127.0.0.1:PORT/index.html
        │        注入 httpMirrorScript：缺 key 才回填 + 写入写穿到原生镜像
        └ 失败 → file:// + polyfillScript（顶替 window.localStorage，写穿到原生）
     → http 模式加载失败还会自动再退回 file://
```

- 固定端口才有稳定 origin；端口顺延会让老 origin 的数据变孤儿，所以原生另存一份镜像（`Application Support/NengmaoKeBiao/webstore.json`）负责回填。
- 镜像**只填空缺、不覆盖**，避免旧数据盖新数据。
- WebKit 实测（`webkit_tests.py`）：`defineProperty(window,'localStorage')` 确实能遮蔽原生对象，polyfill 的 seed/读写/删除/长度全部按 Storage 语义工作。

### 3. 三段核心逻辑抽出来，变成可单测（这一版最大的工程收益）

| 新文件 | 作用 | 为什么抽出来 |
| --- | --- | --- |
| `JSLiteral.swift` | Swift 字符串 → JS 字面量 | 转义写错 = 注入脚本语法错误 = 存储悄悄失效，编译期看不出来。现在用真 Swift 编译 + JSON 反解验证往返 |
| `WebAssetPath.swift` | 请求路径 → bundle 文件、MIME、方法白名单 | 目录穿越是这类小服务器最容易写错的地方。7 种穿越（`..`、`%2e%2e`、反斜杠、`%00`）实测被拒 |
| `CourseMerger.swift` | 多帧课表合并、周次并集 | 决定“自动导入抓全了没有”。10 个场景锁死行为（并集、去重、字符串/浮点周次、越界过滤、身份区分） |
| `WebStoreFile.swift` | 存储落盘内核（原子写、300ms 合并、四项上限、坏文件兜底） | 决定“课表会不会丢”。13 个场景真跑：往返、重载、覆盖、删除、清空、单值/单键/键数/总量超限时**丢新值保旧数据**、坏文件与错类型不崩 |

`ImportViewController` 现在只负责 UIKit 编排，合并逻辑调 `CourseMerger`。

### 4. Cookie / SSO 续命

`CookieVault.swift`：每次页面落地、退出自动导入、以及 VC 销毁时把 WK cookie 落盘（`Application Support/NengmaoKeBiao/cookies.json`，文件保护 `completeUntilFirstUserAuthentication`），下次进自动导入先灌回去。跨站 iframe 的第三方 cookie 仍是 iOS 平台硬边界。

### 5. AppIcon / 启动屏

`Assets.xcassets`：AppIcon 9 尺寸（iPhone 全套 + 1024 marketing）、AccentColor、LaunchBackground、LaunchImage；`Info.plist` 补 `CFBundleIconName`、`UILaunchScreen`、`UIUserInterfaceStyle=Light`、`NSAllowsLocalNetworking`。

---

## 三、工具链（都是本机真装过的）

`python scripts/setup_tools.py` 会自动装：

| 工具 | 用途 | 备注 |
| --- | --- | --- |
| tree-sitter + tree_sitter_swift | Swift 语法解析 | 装到 `.tools-py/`（不污染全局） |
| playwright + WebKit | 真 WebKit 引擎测试 | 浏览器落到 `.tools-py/pw-browsers` |
| Swift 6.4.2 for Windows | 编译/运行纯 Foundation 模块 | `winget install --id Swift.Toolchain` |
| VS 2022 Build Tools（MSVC + Windows 11 SDK） | Swift on Windows 的必备依赖 | 缺了会报 `<stdlib.h> file not found` |

Swift 环境有三处坑，`swift_unit_tests.py` 已自动探测，手工跑时注意：

```
SDKROOT = <Swift>/Platforms/<ver>/Windows.platform/Developer/SDKs/Windows.sdk   # 标准库 .swiftmodule 在这
INCLUDE/LIB = MSVC + Windows Kits\{Include,Lib}\<sdkver>                        # C 头 + CRT/系统库
PATH += <Swift>/Runtimes/<ver>/usr/bin                                          # Foundation.dll 等，否则运行期 0xC0000135
```

---

## 四、iOS 上做不到 / 很难做到的事（结论未变）

### A. 分发与安装

| 问题 | 说明 | 可行做法 |
| --- | --- | --- |
| 不能像 APK 一样下载安装 | iOS 只安装签名过的 IPA | Xcode 直装、AltStore/Sideloadly、TestFlight、App Store |
| 免费 Apple ID | 证书 7 天过期，最多 3 个 App | 自用可接受；AltStore 可自动续签（需电脑） |
| 付费开发者账号 | 99 美元/年；Ad Hoc 上限 100 台/年 | 小范围测试用 Ad Hoc 或 TestFlight |
| TestFlight | 内部 100 人基本免审；外部测试需审核；每个构建 90 天 | 最适合同学内测 |
| 企业证书 | 仅限企业内部员工，对外分发会被封号 | 不建议 |

### B. App Store 审核

1. **4.2 最低功能**：纯 WebView 套壳会被拒，需要原生功能（小组件、原生日历、原生提醒）撑起来。
2. **代登录第三方教务系统 / 自动抓取页面**：审核高风险区，学校投诉会下架。
3. 要上架，产品得改成“用户自己导出 xlsx / .ics 再导入”，不做代登录。

### C. WKWebView 与安卓 WebView 的硬差异

| 差异 | 本工程的处理 |
| --- | --- |
| 没有 `addJavascriptInterface` | `WKScriptMessageHandler` + 注入同名 `AndroidBridge` 垫片（实测四个方法参数顺序与 `app.js` 一致） |
| `evaluateJavaScript` 只作用于主 frame | 解析脚本用 `WKUserScript(forMainFrameOnly: false)` 注入每帧，各自 postMessage 汇总（注入包装已在 WebKit 实测） |
| 第三方 Cookie 被 ITP 拦截 | 无公开开关；只能同顶层 WebView 走完跳转 + `WKHTTPCookieStore`/`CookieVault` 补第一方 cookie |
| 自签 / 过期证书 | 只在自动导入 WebView 处理 server trust，失败弹窗、默认取消 |
| `X-Frame-Options` / CSP | 无解，只能整页跳转 |
| `file://` 的 localStorage | **已解决**：主路径换成 127.0.0.1 的 http origin；file:// 仅作兜底（polyfill 已在 WebKit 验证可遮蔽原生对象） |
| 没有 `a.download` / Blob 下载 | 写临时文件 + 系统分享面板 |
| 没有 Service Worker 后台 | 提醒改用原生本地通知 |
| 无法静默后台抓课表 | 只能前台完成导入 |

### D. 提醒与日历

- 本地通知最多 64 条待发，本工程截到 60 条，需要授权。
- `.ics` 走系统分享面板交给“日历”App。

### E. 不走签名的替代方案

- **PWA**：Safari → 添加到主屏幕，0 签名，只能半自动导入。
- **Safari + 文件 App**：Safari 导出 xlsx，存“文件”，再回课表导入。

---

## 五、功能状态

| 模块 | 状态 | 证据 |
| --- | --- | --- |
| 本地课表 Web（完整复用） | 已打包 | 工程校验 + 真实 app.js 在 Chromium/WebKit 跑通 |
| 网页 ↔ 原生桥（4 个方法） | 已实现 | 58 项里 6 项专门验参数映射 |
| 本地 HTTP 服务 | 新增 | 路径/MIME/方法已真编译单测；**NWListener 部分未真机验证** |
| 网页存储镜像 / polyfill | 新增 | Chromium + WebKit 双向验证 |
| 校内登录 WKWebView（桌面 UA、多帧注入） | 已实现 | 注入包装 + 真解析脚本端到端 19 项 |
| EAMS/正方/强智直连课表页；青果/URP 手动点 | 已实现 | 静态审查 + EAMS 路径端到端 |
| 多帧合并（按身份 + 周次并集） | 已实现 | `CourseMerger` 10 个场景单测 |
| 解析结果回传 `importAutoCourses` | 已实现 | 预览→确认→落盘全链路实测 |
| 证书信任 | 已实现 | 静态审查 |
| Cookie / SSO | 已实现（第一方 + 落盘） | 静态审查；第三方 cookie 仍受 ITP 限制 |
| 重复提交防护 | 已实现 | 端到端实测：6 秒内服务器只收到 **1 次** POST |
| 本地通知 / 导出分享 / 诊断 | 已实现 | 静态审查 |
| AppIcon / 启动屏 | 新增 | 尺寸 + alpha 校验 |
| **xcodebuild 编译、真机运行** | **未做** | 需要 macOS |

已知行为差异：网页会把自己识别成“安卓安装版”（检测到 `AndroidBridge`），“下载 APK”卡片自动隐藏；多帧汇总在第一份课程后至少等 5 秒、最后一份后再等 2.5 秒、20 秒硬停；再次导入是覆盖语义（网页原本如此）。

---

## 六、Mac 上要做的（三条路）

### 路 1：本地 Xcode

```bash
cd ios-build
./scripts/build.sh simulator     # 免签名编译，先排除 Swift/类型错误
open NengmaoKeBiao.xcodeproj     # 选 Team → 连 iPhone 运行
DEVELOPMENT_TEAM=XXXXXXXXXX ./scripts/build.sh archive
./scripts/build.sh check         # 只跑静态校验
```

### 路 2：GitHub Actions（不用自己的 Mac）

仓库根 `.github/workflows/ios-build.yml` 会在 `macos-14` 上：静态校验 → 装 Playwright 跑 WebKit/端到端 → `xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO` → 检查 `Web/`、`Scripts/`、`Assets.car` 是否真进了 `.app` → 上传 `build.log` 与 `.app`。

> 本机没有 GitHub 凭据/仓库，所以这一条**本轮没跑**。你把工程推到自己的仓库就会自动出结论。

### 路 3：朋友的 Mac 十分钟

`open NengmaoKeBiao.xcodeproj` → 选 Team → Run。

---

## 七、真机验收清单

0. **先看加载模式**（新增抓手）：连 Mac → Safari → 开发 → 你的 iPhone → 检查 WebView，控制台里 `__TT_LOAD_MODE__` 应该是 `"http"`。若是 `"file"`，说明本地服务没起来、走了兜底（能显示课表，但持久化靠 polyfill）；Xcode 控制台也会打印 `[能猫课表] 网页加载模式: …`。
1. 打开 App 直接进课表页（不是 file:// 的白屏）。
2. 杀掉进程重开，课表还在 → 本地 http origin 的 localStorage 生效。
3. 飞行模式下开 App → 本地服务是回环，应该照常显示。
4. 设置 → 上课提醒，授权后等一条到点。
5. 导出 .ics → 分享面板能选“日历”。
6. 导入 → 自动导入 → 扬州职业技术大学 → 登录 → 状态栏依次：
   “已登录，正在打开我的课表 → 正在识别课程 → 已读取 N 条课程”。
7. 失败点“诊断”，把 `url/cookie/帧数/命中数/auto` 发回；Mac Safari → 开发 → iPhone → 检查 WebView。
8. 换一所正方/强智/青果/URP 学校重复 6–7（这些解析器仍只有 EAMS 的端到端证据）。
9. **证书**：自签/过期证书学校，确认弹窗出现；“取消”停止加载、“继续”能进；退出重进应重新询问。
10. **SSO**：登录后杀掉 App，再进自动导入看是否仍带着登录态（`CookieVault`）。
11. **重复提交**：真机上观察 EAMS 表单只提交一次（本地端到端已证明逻辑对，真机确认网络行为一致）。
12. **无死循环**：登录页 ↔ 课表页反复重定向时最多自动打开课表 3 次。
13. 取消自动导入，回到主课表无残留崩溃。
14. 导入预览确认后，课程块/周次/节次/教室与教务页面一致。

---

## 八、仍然无法验证 / 已知风险

1. **Apple API 签名**：类型检查过了，但桩是我按文档手写的。若 Xcode 报 `cannot find member` / `incorrect argument label`，多半是桩和真 SDK 有出入，不是逻辑问题——按报错改代码即可，改动量很小。
2. **`NWListener` 在真机上能否监听回环**：不能本地验证；三层兜底（探活 → file://、加载失败 → file://），最坏退化成本地 polyfill 方案。用 `__TT_LOAD_MODE__` 一眼就能看出走没走兜底。
3. **`WKUserScript(forMainFrameOnly:false)` 是否真注入跨域 iframe**：注入层逻辑已在 WebKit 验证，但 iOS 的跨域子帧注入仍需真机确认。
4. **证书挑战**是否真的走到 `didReceive challenge`。
5. **CookieVault 的代价**：登录态以明文存在 App 沙盒（`completeUntilFirstUserAuthentication` 保护）。不接受就删掉 `ImportViewController` 里两处调用，回到“每次重新登录”。
6. **多帧窗口够不够**：逻辑有单测，实际帧上报时序要真机看 `framesReported/expectedFrames`。
7. **Archive/TestFlight/审核**：图标补齐了，但 4.2 与“代登录”仍是审核风险。
8. **XcodeGen 与手写 pbxproj**：以 pbxproj 为准，两者别同时改。

---

## 九、文件说明

```
ios-build/
├─ README.md
├─ project.yml                   XcodeGen 定义（可选路线，需与 pbxproj 一致）
├─ generate.sh                   XcodeGen 生成脚本（可选）
├─ NengmaoKeBiao.xcodeproj/      手写工程（含共享 scheme，打开即用）
├─ scripts/
│  ├─ build.sh                   macOS：simulator / archive / check
│  └─ setup_tools.py             Windows：装 tree-sitter / playwright / Swift / MSVC
├─ tools/
│  ├─ make_assets.py             生成 + 校验 Assets.xcassets
│  ├─ gen_xcodeproj.py           生成 project.pbxproj + scheme
│  ├─ validate_project.py        工程结构 / 资源 / Info.plist 校验
│  ├─ check_swift.py             tree-sitter Swift 语法 + #selector 目标检查
│  ├─ sdk_api_audit.py          用 Apple 头文件审计 73 个 API 调用点（--fetch 可下载头文件）
│  ├─ swift_typecheck.py         全部 9 文件类型检查（对 tools/swift_stubs/）
│  ├─ swift_stubs/Stubs.swift    UIKit/WebKit/Network/UN/Security 桩
│  ├─ swift_unit_tests.py        真 Swift 编译 + 跑单测（3 个模块 46 项）
│  ├─ web_layer_tests.py         headless Edge（58 项）
│  ├─ webkit_tests.py            Playwright WebKit（17 项）
│  ├─ import_e2e_tests.py        注入层 + 真 EAMS 脚本端到端（19 项）
│  └─ run_all_checks.py          一键全跑
└─ NengmaoKeBiao/
   ├─ Info.plist                 ATS(WebContent+LocalNetworking)、竖屏、启动屏、图标名
   ├─ MainViewController.swift   主课表 WKWebView + 网页桥 + 本地服务启动/回退
   ├─ ImportViewController.swift 校内登录 + 多帧注入/合并 + 证书 + Cookie + 诊断
   ├─ ReminderScheduler.swift    本地通知
   ├─ WebStorage.swift           存储原生镜像 + 两种注入脚本（落盘委托给 WebStoreFile）
   ├─ WebStoreFile.swift         存储落盘内核（原子写/上限/坏文件兜底，可单测）
   ├─ LocalWebServer.swift       127.0.0.1 静态文件服务（GET/HEAD）
   ├─ WebAssetPath.swift         请求路径 → 文件、MIME、方法白名单（可单测）
   ├─ JSLiteral.swift            Swift 字符串 → JS 字面量（可单测）
   ├─ CourseMerger.swift         多帧课程合并（可单测）
   ├─ CookieVault.swift          cookie 落盘与恢复
   ├─ Assets.xcassets/           AppIcon、AccentColor、启动屏
   ├─ Web/                       网页版运行时
   └─ Scripts/
      ├─ eams-scrape.js          与安卓同一份（端到端测过）
      └─ generic-scrape.js       与安卓同一份
```

常见改动位置：

- 桌面 UA：`ImportViewController.desktopUA`
- 课表页推导：`ImportViewController.timetableURL()` / `loginTargetURL()`
- 多帧等待窗口：`scheduleSettle()`（5 秒 / 2.5 秒）、`scheduleHardStop()`（20 秒）
- 注入重试：`injectedScraper()` 里的 `1200` / `60`
- 桥接字段：`MainViewController.bridgeShim`
- 本地服务端口：`LocalWebServer.candidatePorts`
- 存储上限：`WebStore.maxValueBytes` / `maxTotalBytes`
- Bundle ID / 版本：`tools/gen_xcodeproj.py` 顶部常量（和 `project.yml` 一起改）

---

## 十、最可能卡住的三个点

1. **第一次 xcodebuild 报错**：语法和纯逻辑都验过了，剩下的多半是类型/可选值。把第一屏报错发来，通常一两处收敛。
2. **本地服务起不来**：会静默退到 `file://`（能显示课表，持久化靠 polyfill）。连 Mac 看控制台有没有 `http 模式加载失败，回退 file://`。
3. **登录后又被踢回登录页**：先看诊断里的 cookie 数；若是跨站 iframe 登录，属于第三方 cookie 硬边界，`CookieVault` 帮不上。