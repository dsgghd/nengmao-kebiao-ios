import UIKit
import WebKit
import Security

/// 自动导入页：校内登录 + 注入现有 Android 版解析脚本。
/// 与安卓的差异：WKWebView 不能从主文档遍历跨域 iframe，也不能直接从原生调用子帧 JS，
/// 所以脚本通过 WKUserScript 注入到每一帧，各自解析后用 messageHandler 汇总回原生。
final class ImportViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var onFinish: ((String?) -> Void)?

    private let loginURL: String
    private let schoolName: String
    private let system: String
    private var webView: WKWebView!
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private var statusStrip: UIView?
    private var lastDebug = ""
    private var cookieNote = ""
    private var finished = false
    private var cleanedUp = false

    // 多帧结果按课程身份合并，而不是“取课程数最多的一份”。逻辑在 CourseMerger（可单测）。
    private var merger = CourseMerger()
    private var framesReported = Set<String>()
    private var expectedFrames = 1
    private var firstCourseAt: Date?
    private var settleTimer: Timer?
    private var hardStopTimer: Timer?
    private var lastMeta: [String: Any] = [:]
    private var mainGeneration = 0
    private var mainURL = ""
    // 主 frame 导航后先关闭接收，等新文档 didFinish 再打开，避免上一页的迟到消息串进新页面。
    private var acceptingResults = false
    // 登录页/密码框页面不显示“正在找课表”，否则会被脚本的 debug 消息覆盖提示。
    private var waitingForLogin = false

    // 只允许一次登录成功后自动打开课表，避免登录页 <-> 课表页来回重定向造成死循环。
    private var autoTableLoads = 0
    private var lastAutoTableLoad = Date.distantPast
    // 同一 URL 20 秒内被主 frame 导航超过 4 次就取消，兜底防止表单/重定向无限刷新。
    private var navigationTimes: [String: [Date]] = [:]

    // 证书只信任到“本次自动导入”结束；默认取消，必须用户明确点“继续”。
    private var trustedHosts = Set<String>()
    private var pendingTrust = Set<String>()
    private var trustPromptVisible = false

    private static let desktopUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

    /// documentStart 注入：只负责建立 EamsBridge，并给每条消息带 frame/doc 身份。
    /// 课程消息不在这里跨时间去重：主 frame 导航后原生会短暂关闭接收，子帧的 1.2 秒循环
    /// 会在新页面 didFinish 之后再次上报；真正的去重由原生按课程身份合并完成。
    private static let bridgeShim = #"""
(function(){
  if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.ttImport) return;
  if (window.__ttBridgeInstalled) return;
  window.__ttBridgeInstalled = true;
  var isTop = (window.top === window);
  var frameId = (isTop ? 'top' : 'sub') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  var lastDebug = '';
  function post(o){
    try {
      o.frame = frameId;
      o.top = isTop;
      o.frames = isTop ? (window.frames.length + 1) : 1;
      window.webkit.messageHandlers.ttImport.postMessage(o);
    } catch (e) {}
  }
  window.EamsBridge = {
    onCourses: function(s){
      post({t:'courses', s:String(s || '')});
    },
    onDebug: function(s){
      s = String(s || '');
      if (s === lastDebug) return;
      lastDebug = s;
      post({t:'debug', s:s});
    }
  };
})();
"""#

    init(loginURL: String, schoolName: String, system: String) {
        self.loginURL = loginURL
        self.schoolName = schoolName
        self.system = system
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "ttImport")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        buildWebView()
        loadLoginPage()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || navigationController?.isBeingDismissed == true || presentingViewController == nil {
            finished = true
            settleTimer?.invalidate()
            hardStopTimer?.invalidate()
            cleanup()
        }
    }

    // MARK: - UI

    private func buildUI() {
        let paper = UIColor(red: 0.949, green: 0.933, blue: 0.890, alpha: 1)
        let ink = UIColor(red: 0.078, green: 0.078, blue: 0.078, alpha: 1)
        let red = UIColor(red: 0.827, green: 0.196, blue: 0.157, alpha: 1)
        view.backgroundColor = paper

        let bar = UIView()
        bar.backgroundColor = ink
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let cancel = UIButton(type: .system)
        cancel.setTitle("取消", for: .normal)
        cancel.setTitleColor(paper, for: .normal)
        cancel.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(cancel)

        let diag = UIButton(type: .system)
        diag.setTitle("诊断", for: .normal)
        diag.setTitleColor(red, for: .normal)
        diag.titleLabel?.font = .systemFont(ofSize: 15, weight: .bold)
        diag.addTarget(self, action: #selector(showDiagnostics), for: .touchUpInside)
        diag.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(diag)

        let title = UILabel()
        title.text = schoolName.isEmpty ? "自动导入" : schoolName
        title.textColor = paper
        title.font = .systemFont(ofSize: 15, weight: .black)
        title.lineBreakMode = .byTruncatingTail
        title.translatesAutoresizingMaskIntoConstraints = false
        bar.addSubview(title)

        let strip = UIView()
        strip.backgroundColor = UIColor(red: 0.906, green: 0.882, blue: 0.824, alpha: 1)
        strip.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(strip)

        spinner.color = ink
        spinner.startAnimating()
        spinner.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(spinner)

        statusLabel.text = "请在学校页面完成登录"
        statusLabel.textColor = UIColor(red: 0.29, green: 0.27, blue: 0.24, alpha: 1)
        statusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        statusLabel.numberOfLines = 2
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bar.heightAnchor.constraint(equalToConstant: 52),

            cancel.leadingAnchor.constraint(equalTo: bar.leadingAnchor, constant: 16),
            cancel.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            diag.trailingAnchor.constraint(equalTo: bar.trailingAnchor, constant: -16),
            diag.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.centerXAnchor.constraint(equalTo: bar.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            title.leadingAnchor.constraint(greaterThanOrEqualTo: cancel.trailingAnchor, constant: 12),
            title.trailingAnchor.constraint(lessThanOrEqualTo: diag.leadingAnchor, constant: -12),

            strip.topAnchor.constraint(equalTo: bar.bottomAnchor),
            strip.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            strip.heightAnchor.constraint(equalToConstant: 44),

            spinner.leadingAnchor.constraint(equalTo: strip.leadingAnchor, constant: 16),
            spinner.centerYAnchor.constraint(equalTo: strip.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: spinner.trailingAnchor, constant: 10),
            statusLabel.trailingAnchor.constraint(equalTo: strip.trailingAnchor, constant: -16),
            statusLabel.centerYAnchor.constraint(equalTo: strip.centerYAnchor)
        ])

        self.statusStrip = strip
    }

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.websiteDataStore = .default()

        let controller = WKUserContentController()
        controller.add(self, name: "ttImport")
        controller.addUserScript(WKUserScript(source: Self.bridgeShim,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: false))
        if let scraper = injectedScraper() {
            controller.addUserScript(WKUserScript(source: scraper,
                                                  injectionTime: .atDocumentEnd,
                                                  forMainFrameOnly: false))
        }
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.customUserAgent = Self.desktopUA
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: statusStrip?.bottomAnchor ?? view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    /// 把现有安卓解析脚本包一层：每帧先跑一次，再每 1.2 秒重跑，最多约 72 秒。
    /// 额外做两件事：
    /// 1) 每帧每个 document 最多允许一次自动 form.submit()，防止脚本重跑造成重复提交；
    /// 2) 每帧继续按原节奏重跑，DOM 异步补全后还能上报新结果；桥接层负责相同 JSON 去重。
    private func injectedScraper() -> String? {
        let loginTarget = loginTargetURL()
        let isEams = system.lowercased().contains("eams")
            || loginTarget.lowercased().contains("eams")
            || loginURL.lowercased().contains("eams")
        let name = isEams ? "eams-scrape" : "generic-scrape"
        let scriptInFolder = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "Scripts")
        let scriptAtRoot = Bundle.main.url(forResource: name, withExtension: "js")
        guard let url = scriptInFolder ?? scriptAtRoot,
              let js = try? String(contentsOf: url, encoding: .utf8) else {
            return nil
        }
        return #"""
(function(){
  if (window.__ttScrapeLoop) return;
  window.__ttScrapeLoop = true;
  window.__ttAutoSubmitCount = window.__ttAutoSubmitCount || 0;
  window.__ttLastHref = location.href;
  function __ttInstallSubmitGuard(){
    if (window.__ttSubmitGuardInstalled) return;
    window.__ttSubmitGuardInstalled = true;
    var proto = window.HTMLFormElement && window.HTMLFormElement.prototype;
    if (!proto) return;
    var nativeSubmit = proto.submit;
    var nativeRequestSubmit = proto.requestSubmit;
    if (typeof nativeSubmit === 'function') {
      proto.submit = function(){
        if (window.__ttInScrape) {
          if (window.__ttAutoSubmitCount >= 1) return;
          window.__ttAutoSubmitCount++;
        }
        try {
          return nativeSubmit.apply(this, arguments);
        } catch (e) {
          if (window.__ttInScrape) window.__ttAutoSubmitCount = Math.max(0, window.__ttAutoSubmitCount - 1);
          throw e;
        }
      };
    }
    if (typeof nativeRequestSubmit === 'function') {
      proto.requestSubmit = function(){
        if (window.__ttInScrape) {
          if (window.__ttAutoSubmitCount >= 1) return;
          window.__ttAutoSubmitCount++;
        }
        try {
          return nativeRequestSubmit.apply(this, arguments);
        } catch (e) {
          if (window.__ttInScrape) window.__ttAutoSubmitCount = Math.max(0, window.__ttAutoSubmitCount - 1);
          throw e;
        }
      };
    }
  }
  function __ttRun(){
    if (window.__ttLastHref !== location.href) {
      window.__ttLastHref = location.href;
      window.__ttAutoSubmitCount = 0;
    }
    __ttInstallSubmitGuard();
    window.__ttInScrape = true;
    try { \#(js) } catch (e) {} finally { window.__ttInScrape = false; }
  }
  __ttRun();
  var n = 0;
  var timer = setInterval(function(){
    n++;
    if (n > 60) { clearInterval(timer); return; }
    __ttRun();
  }, 1200);
  window.addEventListener('pagehide', function(){ clearInterval(timer); }, { once: true });
})();
"""#
    }

    private func loadLoginPage() {
        guard let url = URL(string: loginURL),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            statusLabel.text = "登录地址无效（只支持 http/https）"
            spinner.stopAnimating()
            return
        }
        // 加载前先补齐 cookie，三层来源：
        //   1) 上次会话落盘的 cookie（CookieVault，解决 App 被回收后 SSO 掉线）；
        //   2) WKHTTPCookieStore 已有 ↔ NSHTTPCookieStorage 互相同步（第一方）。
        // 第三方 cookie 在 iOS 15 没有公开的放行开关，见 README 的说明。
        let cookieStore = webView.configuration.websiteDataStore.httpCookieStore
        CookieVault.shared.restore(into: cookieStore) { [weak self] in
            guard let self = self, !self.finished else { return }
            self.seedCookies(for: url) { [weak self] in
                guard let self = self, !self.finished else { return }
                self.webView.load(URLRequest(url: url))
            }
        }
    }

    // MARK: - Cookie

    private func seedCookies(for url: URL, completion: @escaping () -> Void) {
        let store = webView.configuration.websiteDataStore.httpCookieStore
        let shared = HTTPCookieStorage.shared.cookies(for: url) ?? []
        let host = (url.host ?? "").lowercased()
        store.getAllCookies { [weak self] wkCookies in
            guard let self = self else {
                completion()
                return
            }
            let wkForHost = wkCookies.filter { self.cookie($0, matches: host) }
            // WKWebView 的 cookie 是权威来源；把已有第一方 cookie 回写到 NSHTTPCookieStorage，
            // 再把 shared 里有、WK 里没有的补进 WKHTTPCookieStore。
            for cookie in wkForHost {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
            let existing = Set(wkCookies.map { self.cookieIdentity($0) })
            let toSet = shared.filter { !existing.contains(self.cookieIdentity($0)) }
            let group = DispatchGroup()
            for cookie in toSet {
                group.enter()
                store.setCookie(cookie) { group.leave() }
            }
            group.notify(queue: .main) {
                self.cookieNote = "before: wk=\(wkForHost.count), shared=\(shared.count)"
                completion()
            }
        }
    }

    private func inspectCookies(for url: URL?) {
        guard let url = url else { return }
        let store = webView.configuration.websiteDataStore.httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self, !self.finished else { return }
            let host = (url.host ?? "").lowercased()
            let firstParty = cookies.filter { self.cookie($0, matches: host) }
            for cookie in firstParty {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
            self.cookieNote = "after: \(firstParty.count) first-party cookie(s)"
        }
    }

    private func cookie(_ cookie: HTTPCookie, matches host: String) -> Bool {
        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !domain.isEmpty, !host.isEmpty else { return false }
        return host == domain || host.hasSuffix("." + domain)
    }

    private func cookieIdentity(_ cookie: HTTPCookie) -> String {
        return [cookie.name, cookie.domain.lowercased(), cookie.path].joined(separator: "|")
    }

    // MARK: - 消息

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !finished, acceptingResults else { return }
        guard let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        let raw = body["s"] as? String ?? ""
        let frame = body["frame"] as? String ?? ""
        let isTop = body["top"] as? Bool ?? message.frameInfo.isMainFrame
        let frames = (body["frames"] as? NSNumber)?.intValue ?? 1
        if type == "courses" {
            handleCourses(raw, frame: frame.isEmpty ? (isTop ? "top" : "sub-unknown") : frame,
                          isTop: isTop, frames: frames)
        } else if type == "debug" {
            lastDebug = raw
            updateDebug(raw)
        }
    }

    private func handleCourses(_ json: String, frame: String, isTop: Bool, frames: Int) {
        guard !finished, let obj = jsonObject(json) else { return }
        if frames > expectedFrames { expectedFrames = frames }
        framesReported.insert(frame)
        if let title = obj["title"] as? String, !title.isEmpty { lastMeta["title"] = title }
        if let url = obj["url"] as? String, !url.isEmpty { lastMeta["url"] = url }

        let courses = obj["courses"] as? [[String: Any]] ?? []
        if !courses.isEmpty {
            waitingForLogin = false
        }
        if courses.isEmpty {
            if isTop { mainURL = obj["url"] as? String ?? mainURL }
            return
        }

        var changed = false
        for course in courses {
            if merger.merge(course) { changed = true }
        }
        let now = Date()
        if firstCourseAt == nil {
            firstCourseAt = now
            scheduleHardStop()
        }
        if changed {
            statusLabel.text = "已合并 \(merger.count) 条课程，正在等待其他 frame…"
            spinner.startAnimating()
            // 只有真正新增/补全了课程才重置安静期，避免子帧每 1.2 秒重复上报把完成时间无限推后。
            scheduleSettle()
        }
    }

    private func jsonObject(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: Any] else { return nil }
        return dict
    }

    /// 第一次收到课程后至少等 5 秒，且最后一次上报后再等 2.5 秒，给子帧留出上报时间；
    /// 20 秒硬停止，避免某个 frame 永远不回调导致页面卡住。
    private func scheduleSettle() {
        settleTimer?.invalidate()
        let elapsed = Date().timeIntervalSince(firstCourseAt ?? Date())
        let delay = max(2.5, 5.0 - elapsed)
        settleTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self = self, !self.finished else { return }
            self.settleTimer = nil
            self.finishWithMergedCourses()
        }
    }

    private func scheduleHardStop() {
        hardStopTimer?.invalidate()
        hardStopTimer = Timer.scheduledTimer(withTimeInterval: 20.0, repeats: false) { [weak self] _ in
            guard let self = self, !self.finished else { return }
            self.hardStopTimer = nil
            self.finishWithMergedCourses()
        }
    }

    private func finishWithMergedCourses() {
        guard !finished, merger.count > 0 else { return }
        let courses = merger.courses
        guard !courses.isEmpty else { return }
        var payload: [String: Any] = ["ok": true, "courses": courses]
        if let title = lastMeta["title"] as? String { payload["title"] = title }
        if let url = lastMeta["url"] as? String {
            payload["url"] = url
        } else if !mainURL.isEmpty {
            payload["url"] = mainURL
        } else if let current = webView.url?.absoluteString {
            payload["url"] = current
        }
        let debugInfo: [String: Any] = [
            "nativeMerged": true,
            "framesReported": framesReported.count,
            "expectedFrames": expectedFrames
        ]
        payload["debug"] = debugInfo
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let json = String(data: data, encoding: .utf8) else { return }
        statusLabel.text = "已读取 \(courses.count) 条课程"
        finish(json)
    }

    private func updateDebug(_ json: String) {
        guard !waitingForLogin else { return }
        guard let obj = jsonObject(json) else { return }
        let frames = CourseMerger.intValue(obj["frames"]) ?? 0
        let titled = CourseMerger.intValue(obj["titled"]) ?? 0
        let activities = CourseMerger.intValue(obj["activities"]) ?? 0
        let courses = CourseMerger.intValue(obj["courses"]) ?? 0
        let auto = obj["auto"] as? String ?? ""
        if titled + activities + courses > 0 {
            statusLabel.text = "正在识别课程…（帧 \(frames) · 命中 \(titled + activities + courses)）"
        } else if auto == "no-params" || auto == "none" {
            statusLabel.text = "请在页面上选择学年学期（如 2026-2027-1）"
        } else if frames > 0 {
            statusLabel.text = "已进入系统，正在找课表…"
        }
    }

    // MARK: - 导航

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard !finished else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame == true,
           let url = navigationAction.request.url?.absoluteString,
           shouldThrottleNavigation(to: url) {
            statusLabel.text = "检测到重复跳转，已停止自动刷新"
            spinner.stopAnimating()
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func shouldThrottleNavigation(to url: String) -> Bool {
        let comps = URLComponents(string: url)
        // 用 host+path 做 key，避免每次带不同 ?t= 时间戳的刷新绕过限制。
        let key = (comps?.host ?? "") + (comps?.path ?? url)
        let now = Date()
        var times = (navigationTimes[key] ?? []).filter { now.timeIntervalSince($0) < 20 }
        times.append(now)
        navigationTimes[key] = times
        return times.count > 4
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard !finished else { return }
        mainGeneration += 1
        acceptingResults = false
        waitingForLogin = false
        resetAggregation()
        statusLabel.text = "正在加载…"
        spinner.startAnimating()
    }

    private func resetAggregation() {
        settleTimer?.invalidate()
        hardStopTimer?.invalidate()
        settleTimer = nil
        hardStopTimer = nil
        merger.reset()
        framesReported.removeAll()
        expectedFrames = 1
        firstCourseAt = nil
        lastMeta.removeAll()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !finished, let current = webView.url?.absoluteString else { return }
        mainURL = current
        inspectCookies(for: webView.url)
        let low = current.lowercased()
        let generation = mainGeneration
        enableResultAcceptance(for: generation)
        // 每个页面落地后都把 cookie 存一份：登录成功后即使 App 被系统回收，
        // 下次进入自动导入仍带着登录态。
        CookieVault.shared.capture(from: webView.configuration.websiteDataStore.httpCookieStore)

        if isLoginPage(low) {
            // 只有在离开登录页超过 25 秒后才重置次数，避免登录页与课表页互相跳转时无限重载。
            if Date().timeIntervalSince(lastAutoTableLoad) > 25 {
                autoTableLoads = 0
            }
            waitingForLogin = true
            statusLabel.text = "请在学校页面完成登录"
            spinner.stopAnimating()
            return
        }

        // 安卓用可见密码框判断是否仍停留在登录页；iOS 也做同样检查，避免 URL 猜错。
        webView.evaluateJavaScript(
            "(function(){var p=document.querySelector('input[type=password]');return !!(p && p.offsetParent!==null);})()"
        ) { [weak self] result, _ in
            guard let self = self, !self.finished, generation == self.mainGeneration else { return }
            let hasPassword = (result as? Bool) ?? ((result as? NSNumber)?.boolValue ?? false)
            if hasPassword {
                self.waitingForLogin = true
                self.statusLabel.text = "请在学校页面完成登录"
                self.spinner.stopAnimating()
                return
            }
            self.openTimetableIfNeeded(current: current)
        }
    }

    private func enableResultAcceptance(for generation: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self = self, !self.finished, generation == self.mainGeneration else { return }
            self.acceptingResults = true
        }
    }

    private func openTimetableIfNeeded(current: String) {
        guard !finished else { return }
        guard let table = timetableURL(), let url = URL(string: table) else {
            statusLabel.text = "请在页面里打开「我的课表」"
            spinner.stopAnimating()
            return
        }
        let low = current.lowercased()
        if isTimetablePage(low) || low == table.lowercased() {
            statusLabel.text = "正在读取我的课表…"
            spinner.startAnimating()
            return
        }
        if autoTableLoads >= 3 {
            statusLabel.text = "已登录，请手动打开「我的课表」"
            spinner.stopAnimating()
            return
        }
        let now = Date()
        // 同一页面连续 didFinish 时不要反复 load；给上一次跳转留 8 秒，并在冷却结束后重试一次。
        let elapsed = now.timeIntervalSince(lastAutoTableLoad)
        if elapsed < 8 {
            statusLabel.text = "正在等待页面跳转…"
            let generation = mainGeneration
            DispatchQueue.main.asyncAfter(deadline: .now() + (8 - elapsed) + 0.3) { [weak self] in
                guard let self = self, !self.finished, generation == self.mainGeneration,
                      self.webView.url?.absoluteString == current else { return }
                self.openTimetableIfNeeded(current: current)
            }
            return
        }
        autoTableLoads += 1
        lastAutoTableLoad = now
        statusLabel.text = "已登录，正在打开我的课表…"
        spinner.startAnimating()
        let generation = mainGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, !self.finished, generation == self.mainGeneration else { return }
            self.webView.load(URLRequest(url: url))
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        guard !isCancellation(error) else { return }
        statusLabel.text = "加载失败：" + error.localizedDescription
        spinner.stopAnimating()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        guard !isCancellation(error) else { return }
        statusLabel.text = "打不开页面：" + error.localizedDescription
        spinner.stopAnimating()
    }

    private func isCancellation(_ error: Error) -> Bool {
        return (error as NSError).code == NSURLErrorCancelled
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    // MARK: - 证书

    /// 只作用于自动导入这个 WKWebView；主课表 WebView 不实现此方法。
    /// 系统信任链校验通过 -> 交给系统；失败 -> 弹窗让用户明确选择，默认“取消”。
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                 completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        if SecTrustEvaluateWithError(trust, nil) {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let host = challenge.protectionSpace.host
        if trustedHosts.contains(host) {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        if pendingTrust.contains(host) || trustPromptVisible || presentedViewController != nil || view.window == nil {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        pendingTrust.insert(host)
        trustPromptVisible = true
        var didComplete = false
        let complete: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void = { disposition, credential in
            guard !didComplete else { return }
            didComplete = true
            self.pendingTrust.remove(host)
            self.trustPromptVisible = false
            completionHandler(disposition, credential)
        }
        let alert = UIAlertController(
            title: "证书不受信任",
            message: "无法验证 \(host) 的 HTTPS 证书。只有确认这是学校教务或统一认证站点时才继续；继续会信任该证书直到本次导入结束。",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in
            complete(.cancelAuthenticationChallenge, nil)
        })
        alert.addAction(UIAlertAction(title: "继续", style: .destructive) { _ in
            self.trustedHosts.insert(host)
            complete(.useCredential, URLCredential(trust: trust))
        })
        present(alert, animated: true)
    }

    // MARK: - 动作

    @objc private func cancelTapped() {
        finish(nil)
    }

    @objc private func showDiagnostics() {
        let url = webView?.url?.absoluteString ?? ""
        let info = "url=\(url)\ncookie=\(cookieNote)\n\(lastDebug)"
        UIPasteboard.general.string = info
        let alert = UIAlertController(title: "诊断信息已复制",
                                      message: lastDebug.isEmpty ? "还没有收到脚本回报，可先登录并打开课表页。" : "包含帧数、命中数、解析条数与页面状态。",
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default))
        present(alert, animated: true)
    }

    private func finish(_ payload: String?) {
        guard !finished else { return }
        finished = true
        settleTimer?.invalidate()
        hardStopTimer?.invalidate()
        settleTimer = nil
        hardStopTimer = nil
        cleanup()
        onFinish?(payload)
        dismiss(animated: true)
    }

    private func cleanup() {
        guard !cleanedUp else { return }
        cleanedUp = true
        if let store = webView?.configuration.websiteDataStore.httpCookieStore {
            CookieVault.shared.capture(from: store)
        }
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "ttImport")
    }

    // MARK: - 地址推导

    private func isLoginPage(_ low: String) -> Bool {
        return low.contains("login") || low.contains("cas") || low.contains("authserver")
            || low.contains("passport") || low.contains("sso")
    }

    private func isTimetablePage(_ low: String) -> Bool {
        return low.contains("coursetableforstd") || low.contains("xskbcx") || low.contains("xskb_list")
            || low.contains("kbcx") || low.contains("kb_list") || low.contains("timetable")
    }

    /// CAS 统一认证的 login?service=... 里，真正的教务入口在 service 参数；安卓也是这么取的。
    private func loginTargetURL() -> String {
        guard let comps = URLComponents(string: loginURL),
              let service = comps.queryItems?.first(where: { $0.name.lowercased() == "service" })?.value,
              !service.isEmpty else {
            return loginURL
        }
        return service
    }

    /// 与安卓 AutoImportActivity.deriveTimetableUrl 保持一致：
    /// EAMS / 正方 / 强智 直接打开课表页；青果、URP、统一认证留给页面内点击。
    private func timetableURL() -> String? {
        let target = loginTargetURL()
        guard let comps = URLComponents(string: target),
              let scheme = comps.scheme,
              let host = comps.host else { return nil }
        let origin = scheme + "://" + host + (comps.port.map { ":\($0)" } ?? "")
        let low = target.lowercased()
        let sys = system.lowercased()

        if sys.contains("eams") || low.contains("eams") {
            if let range = target.range(of: "/eams/", options: .caseInsensitive) {
                return String(target[..<range.upperBound]) + "courseTableForStd.action"
            }
            return origin + "/eams/courseTableForStd.action"
        }
        if sys.contains("正方") || low.contains("/jwglxt/") {
            if let range = target.range(of: "/jwglxt/", options: .caseInsensitive) {
                return String(target[..<range.upperBound]) + "kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151"
            }
        }
        if sys.contains("强智") || low.contains("/jsxsd/") {
            if let range = target.range(of: "/jsxsd/", options: .caseInsensitive) {
                return String(target[..<range.upperBound]) + "xskb/xskb_list.do"
            }
        }
        return nil
    }
}