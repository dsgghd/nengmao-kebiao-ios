import Foundation
import Network

/// 极小的本地静态文件服务：把 bundle 里的 Web/ 挂到 127.0.0.1 上。
///
/// 为什么需要它：iOS 上 `loadFileURL` 打开的是 file:// origin，WebKit 对 file:// 的
/// localStorage 没有持久化保证（进程回收、系统清理、策略变化都可能丢）。换成固定的
/// `http://127.0.0.1:PORT` origin 后：
///   * localStorage 是正常 Web Storage，写入即落盘；
///   * 每次启动 origin 相同（端口固定），数据不会因为 origin 变化而丢失；
///   * 网页代码零改动（相对路径、manifest、图标都照常加载）。
///
/// 只支持 GET/HEAD，只服务 root 目录内的文件。启动失败时由调用方回退到 file://，
/// 所以这个服务坏掉不会导致 App 打不开。
final class LocalWebServer {
    static let shared = LocalWebServer()

    /// 端口固定，origin 才能稳定；被占用时依次顺延。
    /// 端口变了会让上一个端口的 localStorage 变成孤儿数据，因此 WebStore 会负责迁移。
    static let candidatePorts: [UInt16] = [47821, 47822, 47823, 47824, 47825, 47826]

    private(set) var baseURL: URL?
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.kebiao.localhttp")
    private var root: URL?
    private var attempt = 0
    private var finished = false

    private init() {}

    /// 启动服务并在主线程回调；回调只会在成功（baseURL）或战略放弃（nil）时调用一次。
    func start(root: URL, completion: @escaping (URL?) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            if let base = self.baseURL, self.listener != nil {
                DispatchQueue.main.async { completion(base) }
                return
            }
            self.root = root.standardizedFileURL
            self.attempt = 0
            self.finished = false
            self.tryListen(completion: completion)
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.listener?.cancel()
            self.listener = nil
            self.baseURL = nil
        }
    }

    // MARK: - 监听

    private func tryListen(completion: @escaping (URL?) -> Void) {
        guard !finished else { return }
        guard attempt < LocalWebServer.candidatePorts.count else {
            settle(nil, completion: completion)
            return
        }
        let port = LocalWebServer.candidatePorts[attempt]
        attempt += 1

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        guard let nwPort = NWEndpoint.Port(rawValue: port),
              let listener = try? NWListener(using: params, on: nwPort) else {
            tryListen(completion: completion)
            return
        }

        // 同一次尝试里的状态回调可能是 failed -> cancelled，用这个标记保证只处理一次。
        var attemptSettled = false
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
            guard let self = self, !attemptSettled, !self.finished else { return }
            switch state {
            case .ready:
                attemptSettled = true
                self.listener = listener
                let base = URL(string: "http://127.0.0.1:\(port)/")
                self.baseURL = base
                self.settle(base, completion: completion)
            case .failed:
                attemptSettled = true
                listener.newConnectionHandler = nil
                self.tryListen(completion: completion)
            default:
                break
            }
        }
        listener.start(queue: queue)

        // 兜底：端口被防火墙/系统卡住时不要无限等待，2.5 秒后回退 file://。
        queue.asyncAfter(deadline: .now() + 2.5) { [weak self, weak listener] in
            guard let self = self, !attemptSettled, !self.finished else { return }
            attemptSettled = true
            listener?.cancel()
            self.tryListen(completion: completion)
        }
    }

    private func settle(_ url: URL?, completion: @escaping (URL?) -> Void) {
        guard !finished else { return }
        finished = true
        DispatchQueue.main.async { completion(url) }
    }

    // MARK: - 请求处理

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        var buffer = Data()

        func receiveMore() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, isComplete, error in
                guard let self = self else { return }
                if let data = data { buffer.append(data) }
                if error != nil {
                    connection.cancel()
                    return
                }
                if let headEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                    let head = String(decoding: buffer[buffer.startIndex..<headEnd.lowerBound], as: UTF8.self)
                    self.respond(on: connection, requestHead: head)
                    return
                }
                if buffer.count > 16384 || isComplete {
                    connection.cancel()
                    return
                }
                receiveMore()
            }
        }
        receiveMore()
    }

    private func respond(on connection: NWConnection, requestHead: String) {
        guard let requestLine = requestHead.split(separator: "\r\n").first else {
            send(connection, status: "400 Bad Request", type: "text/plain; charset=utf-8",
                 body: Data("bad request".utf8))
            return
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
            send(connection, status: "400 Bad Request", type: "text/plain; charset=utf-8",
                 body: Data("bad request".utf8))
            return
        }
        let method = String(parts[0]).uppercased()
        let target = String(parts[1])
        guard WebAssetPath.methodAllowed(method) else {
            send(connection, status: "405 Method Not Allowed", type: "text/plain; charset=utf-8",
                 body: Data("method not allowed".utf8))
            return
        }
        guard let root = root,
              let file = WebAssetPath.resolve(root: root, target: target),
              let data = try? Data(contentsOf: file, options: [.mappedIfSafe]) else {
            send(connection, status: "404 Not Found", type: "text/plain; charset=utf-8",
                 body: Data("not found".utf8))
            return
        }
        send(connection, status: "200 OK", type: WebAssetPath.mimeType(forExtension: file.pathExtension),
             body: method == "HEAD" ? Data() : data, contentLength: data.count)
    }

    private func send(_ connection: NWConnection, status: String, type: String,
                      body: Data, contentLength: Int? = nil) {
        let length = contentLength ?? body.count
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: \(type)\r\n"
        head += "Content-Length: \(length)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: close\r\n\r\n"
        var payload = Data(head.utf8)
        payload.append(body)
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

}