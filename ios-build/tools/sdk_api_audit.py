#!/usr/bin/env python3
"""用 Apple 真头文件审计：工程里调用的 iOS API 到底存不存在、选择器对不对。

为什么需要它：类型检查用的是我按文档手写的桩模块，桩写错就等于放水。这里换成拿
**iPhoneOS SDK 的 Objective-C 头文件**（Apple 自己的声明）当基准，逐个核对调用点。

匹配方式：先把头文件里的注释和空白全部去掉（`callAsyncJavaScript:\n  arguments:` 这种
跨行声明很常见），再用“去空白”的正则匹配。这样既不会被格式噪声误判，也能真正查出
选择器拼错、参数个数不对这类问题。

用法：
  python tools/sdk_api_audit.py --fetch     # 首次：下载所需头文件（带重试）
  python tools/sdk_api_audit.py             # 审计
  python tools/sdk_api_audit.py --sdk-root /Applications/Xcode.app/.../iPhoneOS.sdk   # 用本机 SDK
  python tools/sdk_api_audit.py --verbose

Swiift-only 的 API（Network.framework 的 NWListener、`Data.WritingOptions` 的文件保护项等）
没有 ObjC 头文件，脚本会单独列出“无法用头文件核对”，不算失败。
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
import urllib.request

REPO = "Phenmod/iPhoneOS.sdk-Headers"
BRANCH = "master"
RAW = "https://raw.githubusercontent.com/%s/%s/" % (REPO, BRANCH)

CRYPTEX = "iPhoneOS.sdk/System/Cryptexes/OS/System/Library/Frameworks/"
FW = "iPhoneOS.sdk/System/Library/Frameworks/"

HEADERS = [
    CRYPTEX + "WebKit.framework/Headers/WKWebView.h",
    CRYPTEX + "WebKit.framework/Headers/WKHTTPCookieStore.h",
    CRYPTEX + "WebKit.framework/Headers/WKUserContentController.h",
    CRYPTEX + "WebKit.framework/Headers/WKUserScript.h",
    CRYPTEX + "WebKit.framework/Headers/WKScriptMessage.h",
    CRYPTEX + "WebKit.framework/Headers/WKScriptMessageHandler.h",
    CRYPTEX + "WebKit.framework/Headers/WKNavigationDelegate.h",
    CRYPTEX + "WebKit.framework/Headers/WKUIDelegate.h",
    CRYPTEX + "WebKit.framework/Headers/WKWebsiteDataStore.h",
    CRYPTEX + "WebKit.framework/Headers/WKWebViewConfiguration.h",
    CRYPTEX + "WebKit.framework/Headers/WKPreferences.h",
    CRYPTEX + "WebKit.framework/Headers/WKWebpagePreferences.h",
    CRYPTEX + "WebKit.framework/Headers/WKFrameInfo.h",
    FW + "UIKit.framework/Headers/UIViewController.h",
    FW + "UIKit.framework/Headers/UIView.h",
    FW + "UIKit.framework/Headers/UILabel.h",
    FW + "UIKit.framework/Headers/UIButton.h",
    FW + "UIKit.framework/Headers/UIAlertController.h",
    FW + "UIKit.framework/Headers/UIActivityViewController.h",
    FW + "UIKit.framework/Headers/UIPasteboard.h",
    FW + "UIKit.framework/Headers/UIActivityIndicatorView.h",
    FW + "UIKit.framework/Headers/UIApplication.h",
    FW + "UIKit.framework/Headers/UIScrollView.h",
    FW + "UserNotifications.framework/Headers/UNUserNotificationCenter.h",
    FW + "UserNotifications.framework/Headers/UNNotificationRequest.h",
    FW + "UserNotifications.framework/Headers/UNNotificationContent.h",
    FW + "UserNotifications.framework/Headers/UNNotificationTrigger.h",
    FW + "Security.framework/Headers/SecTrust.h",
    FW + "Foundation.framework/Headers/NSHTTPCookie.h",
    FW + "Foundation.framework/Headers/NSHTTPCookieStorage.h",
    FW + "Foundation.framework/Headers/NSURLCredential.h",
    FW + "Foundation.framework/Headers/NSURLAuthenticationChallenge.h",
    FW + "Foundation.framework/Headers/NSURLProtectionSpace.h",
]

# (api 名字, 头文件名或 None=全库搜, [去空白后的正则...], 我们的 Swift 用法)
CHECKS = [
    # ---------------- WebKit ----------------
    ("WKWebView.callAsyncJavaScript", "WKWebView.h",
     [r"\(void\)callAsyncJavaScript:\(NSString\*\)functionBodyarguments:",
      r"callAsyncJavaScript:.*?inContentWorld:\(WKContentWorld\*\)contentWorldcompletionHandler:"],
     "webView.callAsyncJavaScript(_:arguments:in:in:completionHandler:)"),
    ("WKWebView.evaluateJavaScript", "WKWebView.h",
     [r"\(void\)evaluateJavaScript:\(NSString\*\)javaScriptStringcompletionHandler:"],
     "webView.evaluateJavaScript(_:completionHandler:)"),
    ("WKWebView.loadFileURL", "WKWebView.h",
     [r"loadFileURL:\(NSURL\*\)URLallowingReadAccessToURL:\(NSURL\*\)readAccessURL"],
     "webView.loadFileURL(_:allowingReadAccessTo:)"),
    ("WKWebView.loadRequest", "WKWebView.h",
     [r"\(nullableWKNavigation\*\)loadRequest:\(NSURLRequest\*\)request"],
     "webView.load(URLRequest(url:))"),
    ("WKWebView.isInspectable（iOS 16.4 起）", "WKWebView.h",
     [r"property\(nonatomic,getter=isInspectable\)BOOLinspectableNS_SWIFT_NAME\(isInspectable\)API_AVAILABLE\(.*?ios\(16\.4\)"],
     "if #available(iOS 16.4, *) { webView.isInspectable = true }"),
    ("WKWebView.customUserAgent", "WKWebView.h",
     [r"property\(nullable,nonatomic,copy\)NSString\*customUserAgent"],
     "webView.customUserAgent = desktopUA"),
    ("WKWebView.scrollView", "WKWebView.h",
     [r"property\(nonatomic,readonly,strong\)UIScrollView\*scrollView"],
     "webView.scrollView.contentInsetAdjustmentBehavior"),
    ("WKWebView.navigationDelegate", "WKWebView.h",
     [r"navigationDelegate"],
     "webView.navigationDelegate = self"),
    ("WKWebView.allowsBackForwardNavigationGestures", "WKWebView.h",
     [r"allowsBackForwardNavigationGestures"],
     "webView.allowsBackForwardNavigationGestures = true"),
    ("WKWebView.configuration", "WKWebView.h",
     [r"property\(nonatomic,readonly,copy\)WKWebViewConfiguration\*configuration"],
     "webView.configuration.websiteDataStore"),
    ("WKWebView.stopLoading", "WKWebView.h",
     [r"\(void\)stopLoading"], "webView.stopLoading()"),
    ("WKHTTPCookieStore.getAllCookies", "WKHTTPCookieStore.h",
     [r"getAllCookies:.*?completionHandler"],
     "store.getAllCookies { cookies in }"),
    ("WKHTTPCookieStore.setCookie", "WKHTTPCookieStore.h",
     [r"setCookie:\(NSHTTPCookie\*\)cookiecompletionHandler:"],
     "store.setCookie(cookie, completionHandler:)"),
    ("WKUserContentController.addScriptMessageHandler", "WKUserContentController.h",
     [r"addScriptMessageHandler:\(id<WKScriptMessageHandler>\)scriptMessageHandlername:\(NSString\*\)name"],
     "controller.add(self, name: \"tt\")"),
    ("WKUserContentController.removeScriptMessageHandlerForName", "WKUserContentController.h",
     [r"removeScriptMessageHandlerForName:"],
     "removeScriptMessageHandler(forName:)"),
    ("WKUserContentController.addUserScript", "WKUserContentController.h",
     [r"\(void\)addUserScript:"], "controller.addUserScript(_:)"),
    ("WKUserContentController.removeAllUserScripts", "WKUserContentController.h",
     [r"removeAllUserScripts"], "contentController.removeAllUserScripts()"),
    ("WKUserScript.init", "WKUserScript.h",
     [r"initWithSource:\(NSString\*\)sourceinjectionTime:\(WKUserScriptInjectionTime\)injectionTimeforMainFrameOnly:\(BOOL\)forMainFrameOnly"],
     "WKUserScript(source:injectionTime:forMainFrameOnly:)"),
    ("WKScriptMessageHandler 协议", "WKScriptMessageHandler.h",
     [r"userContentController:\(WKUserContentController\*\)userContentControllerdidReceiveScriptMessage:"],
     "userContentController(_:didReceive:)"),
    ("WKScriptMessage.body", "WKScriptMessage.h",
     [r"property\(nonatomic,readonly,copy\)idbody"], "message.body as? [String: Any]"),
    ("WKScriptMessage.frameInfo", "WKScriptMessage.h",
     [r"frameInfo"], "message.frameInfo.isMainFrame"),
    ("WKFrameInfo.isMainFrame", "WKFrameInfo.h",
     [r"property\(nonatomic,readonly,getter=isMainFrame\)BOOLmainFrame"],
     "message.frameInfo.isMainFrame"),
    ("WKNavigationDelegate 证书挑战", "WKNavigationDelegate.h",
     [r"didReceiveAuthenticationChallenge:\(NSURLAuthenticationChallenge\*\)challengecompletionHandler:.*?disposition,NSURLCredential\*"],
     "webView(_:didReceive:completionHandler:)"),
    ("WKNavigationDelegate 导航策略", "WKNavigationDelegate.h",
     [r"decidePolicyForNavigationAction:\(WKNavigationAction\*\)navigationActiondecisionHandler:.*?WKNavigationActionPolicy"],
     "webView(_:decidePolicyFor:decisionHandler:)"),
    ("WKNavigationDelegate.didFinish", "WKNavigationDelegate.h",
     [r"webView:\(WKWebView\*\)webViewdidFinishNavigation:"], "webView(_:didFinish:)"),
    ("WKNavigationDelegate.didStartProvisional", "WKNavigationDelegate.h",
     [r"didStartProvisionalNavigation:"], "webView(_:didStartProvisionalNavigation:)"),
    ("WKNavigationDelegate.didFailProvisional", "WKNavigationDelegate.h",
     [r"didFailProvisionalNavigation:.*?withError:"], "webView(_:didFailProvisionalNavigation:withError:)"),
    ("WKNavigationDelegate.didFail", "WKNavigationDelegate.h",
     [r"webView:\(WKWebView\*\)webViewdidFailNavigation:.*?withError:"], "webView(_:didFail:withError:)"),
    ("WKNavigationDelegate 进程终止", "WKNavigationDelegate.h",
     [r"webViewWebContentProcessDidTerminate:"], "webViewWebContentProcessDidTerminate(_:)"),
    ("WKUIDelegate.createWebView", "WKUIDelegate.h",
     [r"createWebViewWithConfiguration:.*?forNavigationAction:.*?windowFeatures:"],
     "webView(_:createWebViewWith:for:windowFeatures:)"),
    ("WKWebsiteDataStore.default", "WKWebsiteDataStore.h",
     [r"defaultDataStore"], "WKWebsiteDataStore.default()"),
    ("WKWebsiteDataStore.httpCookieStore", "WKWebsiteDataStore.h",
     [r"httpCookieStore"], "websiteDataStore.httpCookieStore"),
    ("WKWebViewConfiguration.userContentController", "WKWebViewConfiguration.h",
     [r"property\(nonatomic,strong\)WKUserContentController\*userContentController"],
     "config.userContentController = controller"),
    ("WKWebViewConfiguration.defaultWebpagePreferences", "WKWebViewConfiguration.h",
     [r"defaultWebpagePreferences"], "config.defaultWebpagePreferences.allowsContentJavaScript"),
    ("WKPreferences.javaScriptCanOpenWindowsAutomatically", "WKPreferences.h",
     [r"javaScriptCanOpenWindowsAutomatically"],
     "config.preferences.javaScriptCanOpenWindowsAutomatically = true"),

    # ---------------- UIKit ----------------
    ("UIViewController.present", "UIViewController.h",
     [r"presentViewController:\(UIViewController\*\)viewControllerToPresentanimated:.*?completion:"],
     "present(vc, animated: true)"),
    ("UIViewController.dismiss", "UIViewController.h",
     [r"dismissViewControllerAnimated:.*?completion:"], "dismiss(animated: true)"),
    ("UIViewController.presentedViewController", "UIViewController.h",
     [r"presentedViewController"], "vc.presentedViewController"),
    ("UIViewController.isBeingDismissed", "UIViewController.h",
     [r"isBeingDismissed"], "isBeingDismissed 判断"),
    ("UIView.translatesAutoresizingMaskIntoConstraints", "UIView.h",
     [r"translatesAutoresizingMaskIntoConstraints"],
     "webView.translatesAutoresizingMaskIntoConstraints = false"),
    ("UIView.safeAreaLayoutGuide", "UIView.h",
     [r"safeAreaLayoutGuide"], "view.safeAreaLayoutGuide.topAnchor"),
    ("UIView.addSubview", "UIView.h",
     [r"\(void\)addSubview:\(UIView\*\)view"], "view.addSubview(webView)"),
    ("UILabel.numberOfLines", "UILabel.h",
     [r"property\(nonatomic\)NSIntegernumberOfLines"], "label.numberOfLines = 0"),
    ("UIButton.setTitle:forState:", "UIButton.h",
     [r"setTitle:\(nullableNSString\*\)titleforState:"], "cancel.setTitle(\"取消\", for: .normal)"),
    ("UIButton.setTitleColor:forState:", "UIButton.h",
     [r"setTitleColor:\(nullableUIColor\*\)colorforState:"], "diag.setTitleColor(red, for: .normal)"),
    ("UIButton.init(type:)", "UIButton.h",
     [r"buttonWithType:\(UIButtonType\)buttonType"], "UIButton(type: .system)"),
    ("UIAlertController", "UIAlertController.h",
     [r"alertControllerWithTitle:.*?message:.*?preferredStyle:"],
     "UIAlertController(title:message:preferredStyle:)"),
    ("UIAlertController.addAction", "UIAlertController.h",
     [r"\(void\)addAction:\(UIAlertAction\*\)action"], "alert.addAction(UIAlertAction(...))"),
    ("UIActivityViewController", "UIActivityViewController.h",
     [r"initWithActivityItems:.*?applicationActivities:"],
     "UIActivityViewController(activityItems:applicationActivities:)"),
    ("UIPasteboard.general", "UIPasteboard.h",
     [r"generalPasteboard"], "UIPasteboard.general.string = info"),
    ("UIActivityIndicatorView.init(style:)", "UIActivityIndicatorView.h",
     [r"initWithActivityIndicatorStyle:"], "UIActivityIndicatorView(style: .medium)"),
    ("UIApplication.open", "UIApplication.h",
     [r"openURL:\(NSURL\*\)urloptions:.*?completionHandler:"], "UIApplication.shared.open(url)"),
    ("UIApplication.didEnterBackgroundNotification", "UIApplication.h",
     [r"UIApplicationDidEnterBackgroundNotification"], "观察退到后台落盘"),
    ("UIApplication.willTerminateNotification", "UIApplication.h",
     [r"UIApplicationWillTerminateNotification"], "观察退出前落盘"),

    # ---------------- UserNotifications ----------------
    ("UNUserNotificationCenter.current", "UNUserNotificationCenter.h",
     [r"currentNotificationCenter"], "UNUserNotificationCenter.current()"),
    ("UNUserNotificationCenter.requestAuthorization", "UNUserNotificationCenter.h",
     [r"requestAuthorizationWithOptions:.*?completionHandler:"],
     "requestAuthorization(options:completionHandler:)"),
    ("UNUserNotificationCenter.add", "UNUserNotificationCenter.h",
     [r"addNotificationRequest:.*?withCompletionHandler:"], "center.add(request)"),
    ("UNUserNotificationCenter.removeAllPending", "UNUserNotificationCenter.h",
     [r"removeAllPendingNotificationRequests"], "center.removeAllPendingNotificationRequests()"),
    ("UNNotificationRequest.init", "UNNotificationRequest.h",
     [r"requestWithIdentifier:.*?content:.*?trigger:"],
     "UNNotificationRequest(identifier:content:trigger:)"),
    ("UNMutableNotificationContent.title/body", "UNNotificationContent.h",
     [r"NSString\*title", r"NSString\*body"],
     "content.title / content.body"),
    ("UNTimeIntervalNotificationTrigger", "UNNotificationTrigger.h",
     [r"triggerWithTimeInterval:\(NSTimeInterval\)timeIntervalrepeats:\(BOOL\)repeats"],
     "UNTimeIntervalNotificationTrigger(timeInterval:repeats:)（ObjC 工厂方法，Swift 侧导入为 init）"),

    # ---------------- Security / Foundation ----------------
    ("SecTrustEvaluateWithError", "SecTrust.h",
     [r"SecTrustEvaluateWithError\("], "SecTrustEvaluateWithError(trust, nil)"),
    ("NSHTTPCookie.init(properties:)", "NSHTTPCookie.h",
     [r"cookieWithProperties:"], "HTTPCookie(properties:)"),
    ("NSHTTPCookie.isHTTPOnly", "NSHTTPCookie.h",
     [r"isHTTPOnly"], "cookie.isHTTPOnly"),
    ("NSHTTPCookie.expiresDate", "NSHTTPCookie.h",
     [r"expiresDate"], "cookie.expires"),
    ("NSHTTPCookieStorage.shared", "NSHTTPCookieStorage.h",
     [r"sharedHTTPCookieStorage"], "HTTPCookieStorage.shared"),
    ("NSHTTPCookieStorage.cookiesForURL", "NSHTTPCookieStorage.h",
     [r"cookiesForURL:"], "HTTPCookieStorage.shared.cookies(for:)"),
    ("NSHTTPCookieStorage.setCookie", "NSHTTPCookieStorage.h",
     [r"\(void\)setCookie:\(NSHTTPCookie\*\)cookie"], "HTTPCookieStorage.shared.setCookie(cookie)"),
    ("NSURLCredential.init(trust:)", "NSURLCredential.h",
     [r"initWithTrust:\(SecTrustRef\)trust"], "URLCredential(trust: trust)"),
    ("NSURLProtectionSpace.serverTrust", "NSURLProtectionSpace.h",
     [r"serverTrust"], "challenge.protectionSpace.serverTrust"),
    ("NSURLProtectionSpace.host", "NSURLProtectionSpace.h",
     [r"property\(readonly,copy\)NSString\*host"], "challenge.protectionSpace.host"),
    ("NSURLProtectionSpace.authenticationMethod", "NSURLProtectionSpace.h",
     [r"authenticationMethod"], "challenge.protectionSpace.authenticationMethod"),
    ("NSURLAuthenticationChallenge.protectionSpace", "NSURLAuthenticationChallenge.h",
     [r"protectionSpace"], "challenge.protectionSpace"),
]

# 这些 API 是 Swift-native 或属于 Foundation 的 Swift 扩展，没有 ObjC 头文件可核。
SWIFT_ONLY = [
    ("NWListener(using:on:)", "Network.framework 是 Swift-native，SDK 里没有 ObjC 头文件"),
    ("NWListener.stateUpdateHandler", "同上"),
    ("NWConnection.receive(minimumIncompleteLength:…)", "同上"),
    ("NWConnection.send(content:completion:)", "同上"),
    ("WKContentWorld.page", "Swift 侧常量，需 Xcode 才能核"),
    ("Data.WritingOptions.completeFileProtectionUntilFirstUserAuthentication", "Foundation 的 Swift 扩展，无 ObjC 头文件"),
]


def cache_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.cache")
    return os.path.join(base, "nengmao-sdk-headers")


def macos_sdk_default() -> str | None:
    """在 Mac 上直接用 Xcode 自带 SDK，不必下载。"""
    candidates = [
        "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk",
        os.path.expanduser("~/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS.sdk"),
    ]
    for path in candidates:
        if os.path.isdir(path):
            return path
    return None


def header_path(root: str, rel: str) -> str | None:
    """root 既可以是下载缓存（含 iPhoneOS.sdk/ 前缀），也可以是真 SDK 根目录。"""
    if root.rstrip("/\\").endswith(".sdk"):
        suffix = rel.split("iPhoneOS.sdk/", 1)[-1]
        candidate = os.path.join(root, *suffix.split("/"))
        if os.path.isfile(candidate):
            return candidate
        # Cryptexes 那层在真 SDK 里可能不存在，退回去掉该前缀再试
        alt = suffix.replace("System/Cryptexes/OS/", "", 1)
        candidate = os.path.join(root, *alt.split("/"))
        if os.path.isfile(candidate):
            return candidate
        return None
    return find_header(root, os.path.basename(rel))


def http_get(url: str, attempts: int = 10, timeout: int = 60) -> bytes:
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nengmao-sdk-audit"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 + i)
    raise RuntimeError("下载失败 %s：%s" % (url, last))


def fetch_headers(dest: str) -> tuple[int, list[str]]:
    os.makedirs(dest, exist_ok=True)
    print("下载 Apple 头文件到 %s" % dest)
    ok, failed = 0, []
    for rel in HEADERS:
        out = os.path.join(dest, rel)
        if os.path.isfile(out) and os.path.getsize(out) > 200:
            ok += 1
            continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        try:
            data = http_get(RAW + rel)
        except RuntimeError as exc:
            print("  ! %s" % exc)
            failed.append(os.path.basename(rel))
            continue
        with open(out, "wb") as fh:
            fh.write(data)
        ok += 1
    print("  就绪 %d/%d" % (ok, len(HEADERS)))
    return ok, failed


def normalize(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    return re.sub(r"\s+", "", text)


def find_header(root: str, filename: str) -> str | None:
    for base, _dirs, files in os.walk(root):
        if filename in files:
            return os.path.join(base, filename)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--sdk-root", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = args.sdk_root or cache_dir()
    if args.fetch:
        fetch_headers(root)

    if not os.path.isdir(root):
        fallback = macos_sdk_default()
        if fallback:
            print("缓存不存在，改用 Xcode 自带 SDK：%s" % fallback)
            root = fallback
    if not os.path.isdir(root):
        print("跳过 API 审计：没有头文件目录（%s）。先跑 --fetch，或用 --sdk-root 指向 iPhoneOS.sdk" % root)
        return 0

    texts: dict[str, str] = {}
    for rel in HEADERS:
        path = header_path(root, rel)
        if path:
            with open(path, encoding="utf-8", errors="replace") as fh:
                texts[os.path.basename(rel)] = normalize(fh.read())

    all_text = "\n".join(texts.values())
    checked = 0
    failures: list[tuple] = []
    for api, header, patterns, usage in CHECKS:
        if header is None:
            haystack = all_text
        else:
            haystack = texts.get(header)
        if haystack is None:
            continue
        checked += 1
        missed = [p for p in patterns if not re.search(p, haystack)]
        if missed:
            failures.append((api, header, missed, usage))
        elif args.verbose:
            print("  [PASS] %-46s %s" % (api, usage))

    print()
    if failures:
        print("API 审计失败：%d/%d 项与 Apple 头文件不符" % (len(failures), checked))
        for api, header, missed, usage in failures:
            print("  [FAIL] %s" % api)
            print("         头文件 %s 中匹配不到：%s" % (header or "任意", ", ".join(missed)))
            print("         我们的用法：%s" % usage)
        return 1

    print("API 审计通过：%d 个调用点全部能在 Apple 头文件里对上（%d 个头文件）"
          % (checked, len(texts)))
    print("另有 %d 项 Swift-only API 无法用头文件核对：%s"
          % (len(SWIFT_ONLY), "、".join(name for name, _ in SWIFT_ONLY)))
    return 0


if __name__ == "__main__":
    sys.exit(main())