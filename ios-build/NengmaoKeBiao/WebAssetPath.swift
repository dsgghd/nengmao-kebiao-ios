import Foundation

/// 本地服务的“请求路径 -> bundle 文件”解析规则，以及 Content-Type 映射。
///
/// 单独成文件的原因和 JSLiteral 一样：这里是纯 Foundation，可以在非 Apple 平台上
/// **真编译、真跑单测**（tools/swift_path_test.py）。目录穿越（`..`、`%2e%2e`、绝对路径、
/// 反斜杠）是这类小服务器最容易写错也最危险的地方，必须在能跑的地方跑一遍。
enum WebAssetPath {
    /// 把请求行里的 target（可能带 query/fragment、可能被 percent-encode）解析成 root 下的文件。
    /// 规则：
    ///   * 空、"/" -> index.html
    ///   * 去掉 query 与 fragment，再做 percent 解码
    ///   * 拒绝 `..`、反斜杠、NUL（解码之后判断，防 `%2e%2e` 绕过）
    ///   * 拼出来的绝对路径必须仍在 root 之内
    ///   * 目录（以 / 结尾）也回落到 index.html
    static func resolve(root: URL, target: String) -> URL? {
        var path = target
        if let hash = path.firstIndex(of: "#") { path = String(path[..<hash]) }
        if let query = path.firstIndex(of: "?") { path = String(path[..<query]) }
        if let decoded = path.removingPercentEncoding { path = decoded }
        if path.isEmpty { path = "/" }

        guard !path.contains(".."), !path.contains("\\"), !path.contains("\0") else { return nil }

        var components = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if components.isEmpty || path.hasSuffix("/") {
            components.append("index.html")
        }
        guard !components.isEmpty else { return nil }

        var url = root.standardizedFileURL
        for component in components {
            if component == "." || component.isEmpty { continue }
            url.appendPathComponent(component)
        }
        let standardized = url.standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        let full = standardized.path
        guard full == rootPath || full.hasPrefix(rootPath.hasSuffix("/") ? rootPath : rootPath + "/") else {
            return nil
        }
        return standardized
    }

    /// 只要 GET/HEAD；其他方法由调用方回 405。
    static func methodAllowed(_ method: String) -> Bool {
        let upper = method.uppercased()
        return upper == "GET" || upper == "HEAD"
    }

    static func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest", "manifest": return "application/manifest+json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "txt", "md": return "text/plain; charset=utf-8"
        case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "apk": return "application/vnd.android.package-archive"
        default: return "application/octet-stream"
        }
    }
}