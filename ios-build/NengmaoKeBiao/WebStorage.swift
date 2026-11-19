import Foundation
import WebKit

/// 网页存储的原生副本。
///
/// 主路径（本地 HTTP 服务）：网页用的是 WebKit 真正的 localStorage，这个类只做两件事
///   1) 首屏如果 localStorage 是空的（比如端口顺延导致 origin 变了），把上次的副本回填；
///   2) 页面每次 setItem/removeItem/clear 都写一份到原生文件，作为“迁移用的第二份真身”。
/// 回退路径（file://，本地服务没起来）：WebKit 不保证 file:// 的 localStorage 持久，
///   这时由注入的 polyfill 顶替 window.localStorage，读写走内存 + 写穿到原生。
final class WebStore: NSObject, WKScriptMessageHandler {
    static let shared = WebStore()
    static let handlerName = "store"

    /// 真正的落盘逻辑在 WebStoreFile（纯 Foundation，可在 Windows 上真跑单测）。
    private let file: WebStoreFile

    private override init() {
        file = WebStoreFile(fileURL: WebStore.defaultFileURL())
        super.init()
    }

    private static func defaultFileURL() -> URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = base.appendingPathComponent("NengmaoKeBiao", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("webstore.json")
    }

    /// 进入后台/退出前同步落盘。
    func flush() {
        file.flush()
    }

    private func snapshot() -> [String: String] {
        return file.snapshot()
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                              didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        switch type {
        case "set":
            guard let key = body["k"] as? String,
                  let value = body["v"] as? String,
                  !key.isEmpty else { return }
            file.set(value, for: key)
        case "del":
            if let key = body["k"] as? String, !key.isEmpty { file.remove(key) }
        case "clear":
            file.clear()
        case "flush":
            file.flush()
        default:
            break
        }
    }
}

// MARK: - 注入脚本

extension WebStore {
    /// http 模式：只回填空缺 + 写穿镜像，不覆盖页面自己的真实 localStorage。
    func httpMirrorScript() -> String {
        let seed = JSLiteral.object(snapshot())
        return Self.httpMirrorTemplate.replacingOccurrences(of: "__TT_STORE_SEED__", with: seed)
    }

    /// file:// 回退模式：直接顶替 window.localStorage。
    func polyfillScript() -> String {
        let seed = JSLiteral.object(snapshot())
        return Self.polyfillTemplate.replacingOccurrences(of: "__TT_STORE_SEED__", with: seed)
    }

    // MARK: 注入脚本正文（tools/web_layer_tests.py 会从这两个标记之间抽取并实测）

    static let httpMirrorTemplate = #"""
    (function(){
    /* __TT_STORE_HTTP_BEGIN__ */
      if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.store) return;
      if (window.__ttStoreMirror) return;
      window.__ttStoreMirror = true;
      var seed = __TT_STORE_SEED__;
      var ls = null;
      try { ls = window.localStorage; } catch (e) { ls = null; }
      if (!ls || typeof ls.setItem !== 'function') return;
      function post(o){ try { window.webkit.messageHandlers.store.postMessage(o); } catch (e) {} }
      var hasOwn = Object.prototype.hasOwnProperty;
      var seeded = 0;
      for (var k in seed) {
        if (!hasOwn.call(seed, k)) continue;
        try {
          if (ls.getItem(k) === null) { ls.setItem(k, seed[k]); seeded++; }
        } catch (e) {}
      }
      window.__ttStoreSeeded = seeded;

      var proto = Object.getPrototypeOf(ls) || Storage.prototype;
      if (!proto.__ttMirrorPatched) {
        proto.__ttMirrorPatched = true;
        var origSet = proto.setItem;
        var origRemove = proto.removeItem;
        var origClear = proto.clear;
        proto.setItem = function(key, value){
          var result = origSet.apply(this, arguments);
          if (this === ls) post({ t: 'set', k: String(key), v: String(value) });
          return result;
        };
        proto.removeItem = function(key){
          var result = origRemove.apply(this, arguments);
          if (this === ls) post({ t: 'del', k: String(key) });
          return result;
        };
        proto.clear = function(){
          var result = origClear.apply(this, arguments);
          if (this === ls) post({ t: 'clear' });
          return result;
        };
      }
    /* __TT_STORE_HTTP_END__ */
    })();
    """#

    static let polyfillTemplate = #"""
    (function(){
    /* __TT_STORE_POLYFILL_BEGIN__ */
      if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.store) return;
      if (window.__ttStorePolyfill) return;
      window.__ttStorePolyfill = true;
      var seed = __TT_STORE_SEED__;
      var hasOwn = Object.prototype.hasOwnProperty;
      var mem = Object.create(null);
      for (var seedKey in seed) {
        if (hasOwn.call(seed, seedKey)) mem[seedKey] = String(seed[seedKey]);
      }
      function post(o){ try { window.webkit.messageHandlers.store.postMessage(o); } catch (e) {} }
      function keys(){ return Object.keys(mem); }
      var api = {
        getItem: function(k){ k = String(k); return hasOwn.call(mem, k) ? mem[k] : null; },
        setItem: function(k, v){ k = String(k); v = String(v); mem[k] = v; post({ t: 'set', k: k, v: v }); },
        removeItem: function(k){ k = String(k); if (hasOwn.call(mem, k)) { delete mem[k]; post({ t: 'del', k: k }); } },
        clear: function(){ var all = keys(); for (var i = 0; i < all.length; i++) delete mem[all[i]]; post({ t: 'clear' }); },
        key: function(i){ var all = keys(); i = Number(i) || 0; return i >= 0 && i < all.length ? all[i] : null; }
      };
      Object.defineProperty(api, 'length', { get: function(){ return keys().length; } });
      var installed = false;
      try {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          enumerable: true,
          get: function(){ return api; }
        });
        installed = window.localStorage === api;
      } catch (e) { installed = false; }
      if (!installed) {
        try { delete window.localStorage; } catch (e) {}
        try { window.localStorage = api; installed = window.localStorage === api; } catch (e) {}
      }
      window.__ttStore = api;
      window.__ttStoreInstalled = installed;
    /* __TT_STORE_POLYFILL_END__ */
    })();
    """#
}