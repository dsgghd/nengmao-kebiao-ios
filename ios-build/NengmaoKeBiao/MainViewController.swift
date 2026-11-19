import UIKit
import WebKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // 后台/退出前把网页存储与设置落盘，避免退到后台被系统回收时丢最后一次写入。
        NotificationCenter.default.addObserver(self, selector: #selector(persistStores),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(persistStores),
                                               name: UIApplication.willTerminateNotification, object: nil)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = MainViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    @objc private func persistStores() {
        WebStore.shared.flush()
    }

    // App 在前台时也显示提醒，方便真机验收；默认 UNUserNotificationCenter 前台不弹横幅。
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }
}

final class MainViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let contentController = WKUserContentController()

    /// 主课表有两种加载方式，见 LocalWebServer / WebStore 的注释：
    /// http = 本地 127.0.0.1 服务（首选，localStorage 真持久）；file = 兜底。
    private enum LoadMode { case http, file }
    private var loadMode: LoadMode = .http
    private var contentRoot: URL?
    private var contentIndex: URL?

    // 与网页层的 AndroidBridge 同名，网页代码零改动即可识别为“安装版”。
    // 参数顺序与 app/app.js 的四处调用完全一致：
    // startAutoImport(url, school, system) / openExternal(url)
    // saveFile(name, text, mime) / syncReminders(jsonString)
    private static let bridgeShim = #"""
    (function(){
      if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.tt) return;
      if (window.__ttMainBridgeInstalled) return;
      window.__ttMainBridgeInstalled = true;
      function post(o){ try { window.webkit.messageHandlers.tt.postMessage(o); } catch (e) {} }
      window.AndroidBridge = {
        startAutoImport: function(url, name, sys){ post({t:'auto', url:String(url||''), name:String(name||''), sys:String(sys||'')}); },
        openExternal: function(url){ post({t:'open', url:String(url||'')}); },
        saveFile: function(name, text, mime){ post({t:'save', name:String(name||''), text:String(text||''), mime:String(mime||'text/plain')}); },
        syncReminders: function(json){ post({t:'reminders', json:String(json||'[]')}); }
      };
    })();
    """#

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.949, green: 0.933, blue: 0.890, alpha: 1)

        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.websiteDataStore = .default()
        contentController.add(self, name: "tt")
        contentController.add(WebStore.shared, name: WebStore.handlerName)
        config.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        loadWebApp()
    }

    deinit {
        contentController.removeScriptMessageHandler(forName: "tt")
        contentController.removeScriptMessageHandler(forName: WebStore.handlerName)
    }

    // MARK: - 加载网页

    /// 返回 (可服务目录, index.html)。folder reference 正常时是 Web/ 目录；
    /// Xcode 把资源拍平的情况下退化为 bundle 根目录。
    private func webContent() -> (root: URL, index: URL)? {
        if let dir = Bundle.main.url(forResource: "Web", withExtension: nil),
           let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") {
            return (dir, index)
        }
        if let index = Bundle.main.url(forResource: "index", withExtension: "html") {
            return (index.deletingLastPathComponent(), index)
        }
        return nil
    }

    private func loadWebApp() {
        guard let content = webContent() else {
            showStartupError("Web/index.html 没有打包进 App。请检查 Build Phases → Copy Bundle Resources 里是否有 Web 目录引用（folder reference）。")
            return
        }
        contentRoot = content.root
        contentIndex = content.index

        LocalWebServer.shared.start(root: content.root) { [weak self] base in
            guard let self = self else { return }
            guard let base = base,
                  let indexURL = URL(string: "index.html", relativeTo: base)?.absoluteURL else {
                self.loadFileFallback()
                return
            }
            // 端口起来了不等于能取到文件：先探一次 index.html，拿不到就走 file://。
            self.probe(indexURL) { [weak self] ok in
                guard let self = self else { return }
                if ok {
                    self.loadMode = .http
                    self.installScripts(mode: .http)
                    self.webView.load(URLRequest(url: indexURL))
                } else {
                    self.loadFileFallback()
                }
            }
        }
    }

    /// 用 URLSession 探一下本地服务，避免“端口在、文件取不到”时页面白屏。
    /// 依赖 Info.plist 的 NSAllowsLocalNetworking（ATS 对 127.0.0.1 的例外）。
    private func probe(_ url: URL, completion: @escaping (Bool) -> Void) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let ok = status == 200 && (data?.count ?? 0) > 0
            DispatchQueue.main.async { completion(ok) }
        }.resume()
    }

    private func loadFileFallback() {
        guard let index = contentIndex, let root = contentRoot else {
            showStartupError("Web/index.html 没有打包进 App。")
            return
        }
        loadMode = .file
        contentController.removeAllUserScripts()
        installStoreScript(mode: .file)
        webView.loadFileURL(index, allowingReadAccessTo: root)
    }

    private func installScripts(mode: LoadMode) {
        contentController.removeAllUserScripts()
        installStoreScript(mode: mode)
    }

    private func installStoreScript(mode: LoadMode) {
        let source: String
        switch mode {
        case .http: source = WebStore.shared.httpMirrorScript()
        case .file: source = WebStore.shared.polyfillScript()
        }
        // 让真机排障有个抓手：Safari → 开发 → 你的 iPhone → 检查 WebView，
        // 控制台里 `__TT_LOAD_MODE__` 就是当前走的哪条路（http 正常 / file 是兜底）。
        let modeName = (mode == .http) ? "http" : "file"
        let marker = "window.__TT_LOAD_MODE__ = \"\(modeName)\";\n"
        print("[能猫课表] 网页加载模式: \(modeName)")
        contentController.addUserScript(WKUserScript(source: marker + source,
                                                     injectionTime: .atDocumentStart,
                                                     forMainFrameOnly: true))
        contentController.addUserScript(WKUserScript(source: Self.bridgeShim,
                                                     injectionTime: .atDocumentStart,
                                                     forMainFrameOnly: true))
    }

    private func showStartupError(_ message: String) {
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .darkGray
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.text = message
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
    }

    // MARK: - 网页 -> 原生

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "tt",
              let body = message.body as? [String: Any],
              let type = body["t"] as? String else { return }
        switch type {
        case "auto":
            openImport(url: body["url"] as? String ?? "",
                       name: body["name"] as? String ?? "",
                       system: body["sys"] as? String ?? "")
        case "open":
            if let raw = body["url"] as? String, let url = URL(string: raw),
               let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                UIApplication.shared.open(url)
            }
        case "save":
            saveFile(name: body["name"] as? String ?? "export.txt",
                     text: body["text"] as? String ?? "",
                     mime: body["mime"] as? String ?? "text/plain")
        case "reminders":
            ReminderScheduler.shared.sync(json: body["json"] as? String ?? "[]")
        default:
            break
        }
    }

    private func openImport(url: String, name: String, system: String) {
        guard let target = URL(string: url),
              let scheme = target.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else { return }
        let vc = ImportViewController(loginURL: url, schoolName: name, system: system)
        vc.onFinish = { [weak self] payload in
            guard let self = self,
                  let payload = payload,
                  let data = payload.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) else { return }
            // 用 callAsyncJavaScript 传原生对象，避免把 JSON 拼进 JS 源码导致引号/换行注入，
            // app.js 的 importAutoCourses 会直接收到对象而不是字符串。
            self.webView.callAsyncJavaScript("window.importAutoCourses(payload);",
                                             arguments: ["payload": object],
                                             in: nil,
                                             in: .page) { result in
                if case .failure(let error) = result {
                    print("importAutoCourses failed: \(error.localizedDescription)")
                }
            }
        }
        vc.modalPresentationStyle = .fullScreen
        topMost().present(vc, animated: true)
    }

    private func saveFile(name: String, text: String, mime: String) {
        let base = (name as NSString).lastPathComponent
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let safe = (base.isEmpty || base == "." || base == "..") ? "export.txt" : base
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        do {
            try text.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 60, width: 1, height: 1)
        }
        topMost().present(sheet, animated: true)
    }

    private func topMost() -> UIViewController {
        var vc: UIViewController = self
        while let presented = vc.presentedViewController {
            vc = presented
        }
        return vc
    }

    // MARK: - 导航

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // 课表页只应该在本地 origin 内跳转；外部链接交给系统浏览器，避免被校内页面困住。
        if let url = navigationAction.request.url,
           let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            let host = (url.host ?? "").lowercased()
            if host != "127.0.0.1" && navigationAction.targetFrame?.isMainFrame == true {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    // 网页里的 target="_blank" 在当前 WebView 打开，避免点了没反应。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    // WebKit 子进程被系统回收后自动恢复页面；本地服务还在，直接重载即可。
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        WebStore.shared.flush()
        webView.reload()
    }

    // http 模式加载失败（服务被系统掐断等）时退回 file://，保证 App 还能用。
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fallBackIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fallBackIfNeeded(error)
    }

    private func fallBackIfNeeded(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        guard loadMode == .http else { return }
        print("http 模式加载失败，回退 file://: \(error.localizedDescription)")
        loadFileFallback()
    }
}