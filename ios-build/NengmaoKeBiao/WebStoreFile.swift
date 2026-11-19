import Foundation

/// 网页存储的落盘内核（纯 Foundation，可在 Windows 上真编译真跑，见 tools/swift_unit_tests.py）。
///
/// 职责只有一个：把一份 `[String: String]` 安全地搬到磁盘上再搬回来。
/// 决定“课表会不会丢”的就是它，所以约束都写死在这里：
///   * 写入是**原子**的（先写临时文件再替换），进程被杀不会留下半个 JSON；
///   * 300ms 合并写入，页面连续 setItem 不会打爆磁盘；
///   * 单值/单键/总量都有上限，超限**丢弃新值而不是破坏旧数据**；
///   * 文件坏了（截断、手改、编码错）只当空数据，不崩。
final class WebStoreFile {
    struct Limits {
        var maxKeyBytes = 256
        var maxValueBytes = 1_500_000
        var maxTotalBytes = 12_000_000
        var maxKeys = 400
        var writeDelay: TimeInterval = 0.3
        init() {}
    }

    private let url: URL
    private let limits: Limits
    private let queue = DispatchQueue(label: "com.kebiao.webstore.file")
    private var values: [String: String] = [:]
    private var loaded = false
    private var pendingWrite: DispatchWorkItem?

    init(fileURL: URL, limits: Limits = Limits()) {
        self.url = fileURL
        self.limits = limits
    }

    // MARK: - 读

    /// 同步快照（首次调用会读盘）。
    func snapshot() -> [String: String] {
        return queue.sync { () -> [String: String] in
            loadIfNeeded()
            return values
        }
    }

    // MARK: - 写

    func set(_ value: String, for key: String) {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.loadIfNeeded()
            guard !key.isEmpty, key.utf8.count <= self.limits.maxKeyBytes else { return }
            guard value.utf8.count <= self.limits.maxValueBytes else { return }

            let isNewKey = (self.values[key] == nil)
            if isNewKey && self.values.count >= self.limits.maxKeys { return }

            let previous = self.values[key]
            self.values[key] = value
            if self.totalBytes() > self.limits.maxTotalBytes {
                // 超总量：撤销这次写入，保住已有数据。
                if let previous = previous {
                    self.values[key] = previous
                } else {
                    self.values.removeValue(forKey: key)
                }
                return
            }
            self.scheduleWrite()
        }
    }

    func remove(_ key: String) {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.loadIfNeeded()
            guard self.values.removeValue(forKey: key) != nil else { return }
            self.scheduleWrite()
        }
    }

    func clear() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.loadIfNeeded()
            guard !self.values.isEmpty else { return }
            self.values.removeAll()
            self.scheduleWrite()
        }
    }

    /// 同步落盘（进入后台/退出前调用）。
    func flush() {
        queue.sync { () -> Void in
            pendingWrite?.cancel()
            pendingWrite = nil
            writeNow()
        }
    }

    // MARK: - 内部

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dict = object as? [String: String] else {
            // 文件不存在 / 坏了 / 类型不对：一律当空数据。
            values = [:]
            return
        }
        values = dict
    }

    private func totalBytes() -> Int {
        return values.reduce(0) { $0 + $1.key.utf8.count + $1.value.utf8.count }
    }

    private func scheduleWrite() {
        pendingWrite?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.writeNow()
        }
        pendingWrite = work
        queue.asyncAfter(deadline: .now() + limits.writeDelay, execute: work)
    }

    private func writeNow() {
        loadIfNeeded()
        guard let data = try? JSONSerialization.data(withJSONObject: values, options: []) else { return }
        let directory = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            // 写失败不抛给页面：网页侧仍认为自己写成功了，下次启动回到上一次成功的快照。
            print("WebStoreFile write failed: \(error.localizedDescription)")
        }
    }
}