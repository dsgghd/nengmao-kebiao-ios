import Foundation
import WebKit

/// 教务登录态（cookie）的落盘副本。
///
/// 为什么要它：WKWebView 的 cookie 默认只在进程内有效，App 被系统回收后重新启动，
/// CAS/SSO 的会话 cookie 就没了，于是“登录成功后又被踢回登录页”。
/// 这里在每次 `didFinish` 和退出自动导入时把 cookie 存一份，下次进入自动导入前先灌回去。
///
/// 边界：只处理 WKHTTPCookieStore 里的 cookie；跨站 iframe 的第三方 cookie 仍受 ITP
/// 限制，这个类改变不了（iOS 没有公开的第三方 cookie 开关）。
final class CookieVault {
    static let shared = CookieVault()

    private let queue = DispatchQueue(label: "com.kebiao.cookievault")

    private lazy var fileURL: URL = {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = base.appendingPathComponent("NengmaoKeBiao", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("cookies.json")
    }()

    private init() {}

    /// 把上次保存的 cookie 灌进 WK 的 cookie store；完成后在主线程回调。
    func restore(into store: WKHTTPCookieStore, completion: @escaping () -> Void) {
        queue.async { [weak self] in
            guard let self = self else {
                DispatchQueue.main.async { completion() }
                return
            }
            let cookies = self.load()
            guard !cookies.isEmpty else {
                DispatchQueue.main.async { completion() }
                return
            }
            let group = DispatchGroup()
            for cookie in cookies {
                group.enter()
                store.setCookie(cookie) { group.leave() }
            }
            group.notify(queue: DispatchQueue.main) { completion() }
        }
    }

    /// 把当前 cookie 存盘。过滤掉已过期的（session cookie 没有 expires，保留）。
    func capture(from store: WKHTTPCookieStore, completion: (() -> Void)? = nil) {
        store.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            let now = Date()
            var keep: [HTTPCookie] = []
            for cookie in cookies {
                if let expires = cookie.expiresDate, expires <= now { continue }
                keep.append(cookie)
            }
            self.queue.async {
                self.save(keep)
                if let completion = completion {
                    DispatchQueue.main.async { completion() }
                }
            }
        }
    }

    func clear() {
        queue.async { [weak self] in
            guard let self = self else { return }
            try? FileManager.default.removeItem(at: self.fileURL)
        }
    }

    // MARK: - 序列化

    private func save(_ cookies: [HTTPCookie]) {
        guard !cookies.isEmpty else { return }
        let records: [[String: Any]] = cookies.map { cookie in
            var record: [String: Any] = [
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
                "secure": cookie.isSecure,
                "httpOnly": cookie.isHTTPOnly,
                "version": cookie.version
            ]
            if let expires = cookie.expiresDate {
                record["expires"] = expires.timeIntervalSince1970
            }
            return record
        }
        guard let data = try? JSONSerialization.data(withJSONObject: records, options: []) else { return }
        do {
            try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            print("CookieVault save failed: \(error.localizedDescription)")
        }
    }

    private func load() -> [HTTPCookie] {
        guard let data = try? Data(contentsOf: fileURL),
              let object = try? JSONSerialization.jsonObject(with: data),
              let records = object as? [[String: Any]] else { return [] }
        let now = Date()
        var out: [HTTPCookie] = []
        for record in records {
            guard let name = record["name"] as? String,
                  let value = record["value"] as? String,
                  let domain = record["domain"] as? String,
                  !name.isEmpty, !domain.isEmpty else { continue }
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: name,
                .value: value,
                .domain: domain,
                .path: record["path"] as? String ?? "/"
            ]
            if let secure = record["secure"] as? Bool, secure {
                properties[.secure] = "TRUE"
            }
            if let version = record["version"] as? Int, version > 0 {
                properties[.version] = version
            }
            if let httpOnly = record["httpOnly"] as? Bool, httpOnly {
                properties[HTTPCookiePropertyKey(rawValue: "HttpOnly")] = "TRUE"
            }
            if let epoch = record["expires"] as? Double, epoch > 0 {
                if Date(timeIntervalSince1970: epoch) <= now { continue }
                properties[.expires] = Date(timeIntervalSince1970: epoch)
            }
            if let cookie = HTTPCookie(properties: properties) {
                out.append(cookie)
            }
        }
        return out
    }
}