#!/usr/bin/env python3
"""用 Playwright 的 WebKit 引擎复验网页层——这是离 WKWebView 最近的环境。

Chromium（Edge）能证明脚本逻辑对，但证明不了 WebKit 特有的行为：
  * file:// origin 下 localStorage 到底能不能用；
  * `Object.defineProperty(window,'localStorage',…)` 在 WebKit 里能不能遮蔽原型链上的属性；
  * JSC 引擎跑 app.js 有没有差异。

这里的注入方式用 `page.add_init_script()`，语义等价于 WKUserScript(injectionTime: .atDocumentStart)：
在页面自己的脚本之前执行，且每个新文档都会重新执行。因此“注入后页面能不能看到我们的
localStorage”这件事，测出来的结论可以迁移到 iOS。

用法: python tools/webkit_tests.py
依赖: .tools-py/playwright + `.tools-py/pw-browsers`（首次由 scripts/setup_tools.py 下载）
"""
from __future__ import annotations

import json
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
VENDOR = os.path.join(IOS_BUILD, ".tools-py")
BROWSERS = os.path.join(VENDOR, "pw-browsers")
sys.path.insert(0, VENDOR)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", BROWSERS)

sys.path.insert(0, HERE)

import web_layer_tests as wlt  # noqa: E402

results: list[dict] = []


def record(name: str, ok: bool, detail=None) -> None:
    results.append({"name": name, "pass": bool(ok), "detail": detail, "kind": "assert"})


def record_info(name: str, detail=None) -> None:
    """只记录环境事实，不作为断言（不同引擎/版本行为可能不同）。"""
    results.append({"name": name, "pass": True, "detail": detail, "kind": "info"})


def start_server(harness_html: str = "") -> tuple:
    server = wlt.StaticServer(("127.0.0.1", 0), wlt.make_handler(harness_html.encode("utf-8")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


HANDLER_STUB = """
window.__msgs = [];
window.webkit = { messageHandlers: {
  tt:       { postMessage: function(m){ window.__msgs.push(['tt', m]); } },
  store:    { postMessage: function(m){ window.__msgs.push(['store', m]); } },
  ttImport: { postMessage: function(m){ window.__msgs.push(['ttImport', m]); } }
}};
"""


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        print("跳过 WebKit 测试：playwright 不可用（%s）" % exc)
        print("先跑：python scripts/setup_tools.py")
        return 0

    snippets = wlt.load_snippets()
    server, port = start_server()
    base = "http://127.0.0.1:%d" % port
    # 真实 app.js 的测试用另一个端口 = 另一个 origin，避免和上面的镜像测试互相污染 localStorage
    app_server, app_port = start_server()
    app_base = "http://127.0.0.1:%d" % app_port
    file_url = "file:///" + os.path.join(IOS_BUILD, "NengmaoKeBiao", "Web", "index.html").replace("\\", "/")
    harness_url = base + "/__harness.html"

    with sync_playwright() as pw:
        browser = pw.webkit.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 430, "height": 900})

        # ---------- W1/W2/W3: file:// origin 下的 localStorage 与 polyfill ----------
        page = ctx.new_page()
        page.add_init_script(HANDLER_STUB)
        page.set_content("<title>baseline</title><p>baseline</p>")
        baseline = page.evaluate(
            "() => { try { localStorage.setItem('probe','1'); return 'ok:' + localStorage.getItem('probe'); }"
            " catch (e) { return 'throws:' + e.name; } }"
        )
        record_info("webkit:about-blank-localStorage", baseline)

        page2 = ctx.new_page()
        page2.goto(file_url)
        file_baseline = page2.evaluate(
            "() => { try { localStorage.setItem('probe','1'); return 'ok:' + localStorage.getItem('probe'); }"
            " catch (e) { return 'throws:' + e.name; } }"
        )
        record_info("webkit:file-origin-localStorage", file_baseline)

        # polyfill 通过 init script 注入（= WKUserScript atDocumentStart），再重新加载
        seed = {"tt.settings.v1": '{"school":"示例"}', "tt.data.v1": "[]"}
        polyfill = snippets["polyfill"].replace("__TT_STORE_SEED__", json.dumps(seed, ensure_ascii=False))
        mirror = snippets["mirror"].replace("__TT_STORE_SEED__", json.dumps(seed, ensure_ascii=False))

        page3 = ctx.new_page()
        page3.add_init_script(HANDLER_STUB)
        page3.add_init_script(polyfill)
        page3.goto(file_url)
        report = page3.evaluate(
            """() => {
                const r = {};
                r.installed = window.__ttStoreInstalled;
                r.sameObject = (window.localStorage === window.__ttStore);
                r.seedRead = window.localStorage.getItem('tt.settings.v1');
                try { window.localStorage.setItem('k','v'); r.writeThrough = true; } catch (e) { r.writeThrough = 'throws:' + e.name; }
                r.readBack = window.localStorage.getItem('k');
                r.length = window.localStorage.length;
                r.msgs = (window.__msgs || []).filter(m => m[0] === 'store').map(m => m[1]);
                return r;
            }"""
        )
        record("webkit:polyfill-installed", report.get("installed") is True, report.get("installed"))
        record("webkit:polyfill-shadows-native", report.get("sameObject") is True, report.get("sameObject"))
        record("webkit:polyfill-seed", report.get("seedRead") == '{"school":"示例"}', report.get("seedRead"))
        record("webkit:polyfill-write", report.get("writeThrough") is True and report.get("readBack") == "v",
               [report.get("writeThrough"), report.get("readBack")])
        posted = report.get("msgs") or []
        record("webkit:polyfill-message", any(m.get("t") == "set" and m.get("k") == "k" for m in posted), posted[:2])

        # ---------- W4: http 模式镜像（不覆盖已有值 + 写穿） ----------
        page4 = ctx.new_page()
        page4.add_init_script(HANDLER_STUB)
        page4.add_init_script(mirror)
        page4.goto(harness_url)
        page4.evaluate("() => { localStorage.clear(); localStorage.setItem('tt.data.v1','PRESERVED'); }")
        page4.reload()
        http_report = page4.evaluate(
            """() => {
                const r = {};
                r.seeded = window.__ttStoreSeeded;
                r.kept = localStorage.getItem('tt.data.v1');
                r.filled = localStorage.getItem('tt.settings.v1');
                localStorage.setItem('tt.notes.v1','{"a":1}');
                r.msgs = (window.__msgs || []).filter(m => m[0] === 'store').map(m => m[1]);
                try { sessionStorage.setItem('s','1'); r.session = true; } catch (e) { r.session = 'throws:' + e.name; }
                r.storeCount = (window.__msgs || []).filter(m => m[0] === 'store').length;
                return r;
            }"""
        )
        record("webkit:mirror-seeds-missing", http_report.get("filled") == '{"school":"示例"}', http_report.get("filled"))
        record("webkit:mirror-keeps-existing", http_report.get("kept") == "PRESERVED", http_report.get("kept"))
        record("webkit:mirror-writethrough",
               any(m.get("t") == "set" and m.get("k") == "tt.notes.v1" for m in (http_report.get("msgs") or [])),
               (http_report.get("msgs") or [])[:2])
        record("webkit:mirror-sessionstorage-silent", http_report.get("storeCount") == 1, http_report.get("storeCount"))

        # ---------- W5: 真实 app.js 在 WebKit/JSC 下跑完整导入流程 ----------
        # 用空 seed，模拟“全新安装、原生镜像里还没有课表”的真实首跑状态。
        mirror_empty = snippets["mirror"].replace("__TT_STORE_SEED__", "{}")
        page5 = ctx.new_page()
        page5.add_init_script(HANDLER_STUB)
        page5.add_init_script(mirror_empty)
        page5.goto(app_base + "/index.html")
        page5.wait_for_function("() => typeof window.importAutoCourses === 'function'")
        first = page5.evaluate(
            """() => {
                const r = {};
                r.welcomeVisible = !document.getElementById('welcome').hidden;
                window.importAutoCourses({ ok: true, courses: [
                    { name: '高等数学', teacher: '张三', room: 'A101', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1,2,3] },
                    { name: '大学英语', teacher: '李四', room: 'B202', day: 2, startPeriod: 3, endPeriod: 4, weeks: [1,2] } ]});
                r.rows = document.querySelectorAll('.preview-row').length;
                r.hasConfirm = !!document.getElementById('confirmImport');
                r.storedBeforeConfirm = !!localStorage.getItem('tt.data.v1');
                return r;
            }"""
        )
        record("webkit:app-welcome", first.get("welcomeVisible") is True, first.get("welcomeVisible"))
        record("webkit:app-preview-rows", first.get("rows") == 2, first.get("rows"))
        record("webkit:app-not-stored-before-confirm", first.get("storedBeforeConfirm") is False,
               first.get("storedBeforeConfirm"))

        page5.click("#confirmImport")
        page5.wait_for_timeout(300)
        after = page5.evaluate(
            """() => {
                const r = {};
                const raw = localStorage.getItem('tt.data.v1');
                const data = raw ? JSON.parse(raw) : null;
                const blocks = data && data.blocks ? data.blocks : [];
                r.blocks = blocks.length;
                const math = blocks.filter(b => b.name === '高等数学')[0];
                r.weeks = math ? math.weeks : null;
                r.appVisible = !document.getElementById('app').hidden;
                r.mirrorSet = (window.__msgs || []).filter(m => m[0] === 'store' && m[1].t === 'set').length;
                return r;
            }"""
        )
        record("webkit:app-blocks", after.get("blocks") == 2, after.get("blocks"))
        record("webkit:app-weeks", after.get("weeks") == [1, 2, 3], after.get("weeks"))
        record("webkit:app-visible", after.get("appVisible") is True, after.get("appVisible"))
        record("webkit:app-mirror-saw-writes", (after.get("mirrorSet") or 0) >= 2, after.get("mirrorSet"))

        # 重载后数据还在（= 杀进程重开的等价验证，同一 origin）
        page5.reload()
        page5.wait_for_function("() => typeof window.importAutoCourses === 'function'")
        persisted = page5.evaluate(
            "() => { const raw = localStorage.getItem('tt.data.v1'); const d = raw ? JSON.parse(raw) : null;"
            " return d && d.blocks ? d.blocks.length : -1; }"
        )
        record("webkit:app-persists-after-reload", persisted == 2, persisted)

        browser.close()

    asserts = [r for r in results if r["kind"] == "assert"]
    failed = [r for r in asserts if not r["pass"]]
    for r in results:
        mark = "INFO" if r["kind"] == "info" else ("PASS" if r["pass"] else "FAIL")
        line = "  [%s] %s" % (mark, r["name"])
        if r["detail"] is not None:
            line += "  <- %s" % (json.dumps(r["detail"], ensure_ascii=False)[:160],)
        print(line)
    print("\nWebKit 断言 %d 项，通过 %d 项，失败 %d 项（另有 %d 条环境观测）"
          % (len(asserts), len(asserts) - len(failed), len(failed), len(results) - len(asserts)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())