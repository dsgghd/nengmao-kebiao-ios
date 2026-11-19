#!/usr/bin/env python3
"""端到端测“注入层 + 真实解析脚本”在 WebKit 里能不能真跑出结果。

这里不测模仿品，测的是真件：
  * 注入包装层来自 ImportViewController.injectedScraper() 的原始字符串（把 `\\#(js)` 换成真脚本）
  * 解析脚本来自 Scripts/eams-scrape.js（与安卓同一份，未改）
  * 桥是 MainViewController 里同样的 window.EamsBridge 约定

三个场景：
  E1 课表页：合成一个 EAMS 课表 DOM（td#TD<idx>_0 + title="教师 课程（代码）;（周次,地点）"），
     断言解析出课程、节次按 rowspan 展开、周次/教室/校区都正确。
  E2 重复提交：合成一个含 ids / semester.id 的表单页，跑 6 秒（≈5 轮抓取循环），
     断言只向服务器 POST 了 **1 次**——这是“自动提交会不会重复交”的直接证据。
  E3 空页面：断言 debug 上报正常、不会误报课程。

用法: python tools/import_e2e_tests.py
依赖: .tools-py/playwright + pw-browsers（scripts/setup_tools.py 会装）
"""
from __future__ import annotations

import json
import os
import sys
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
WEB_DIR = os.path.join(APP_DIR, "Web")
VENDOR = os.path.join(IOS_BUILD, ".tools-py")
sys.path.insert(0, VENDOR)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", os.path.join(VENDOR, "pw-browsers"))
sys.path.insert(0, HERE)

import http.server  # noqa: E402
import web_layer_tests as wlt  # noqa: E402

results: list[dict] = []
posts: list[dict] = []


def record(name: str, ok: bool, detail=None) -> None:
    results.append({"name": name, "pass": bool(ok), "detail": detail})


# ------------------------------------------------------------------ 合成页面

def eams_table_page() -> str:
    # 星期 2、第 3 节，连上 2 节 -> idx = (2-1)*12 + (3-1) = 14
    cells = [
        (14, 2, "张三 高等数学（MATH101）;（1-8周, A101(主校区)）"),
        (2, 1, "李四 大学英语;（1-16周单, B202）"),
    ]
    tds = "".join(
        '<td id="TD%d_0" rowspan="%d" title="%s"></td>' % (idx, span, title)
        for idx, span, title in cells
    )
    return ("<!doctype html><meta charset='utf-8'><title>我的课表</title>"
            "<body><table id='table1'><tbody><tr>" + tds + "</tr></tbody></table></body>")


def eams_form_page() -> str:
    return """<!doctype html><meta charset='utf-8'><title>课表</title>
<body>
<div>星期 周一</div>
<form action="/eams/courseTableForStd.action" method="post">
  <input name="ids" value="2023010101">
  <input name="semester.id" value="42">
  <input type="submit" value="查询">
</form>
<script>window.ids = '2023010101'; window.semesterId = '42';</script>
</body>"""


EMPTY_PAGE = "<!doctype html><meta charset='utf-8'><title>空白页</title><body><p>什么都没有</p></body>"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, *args):
        pass

    def _send_html(self, html: str) -> bytes:
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return body

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/eams/courseTableForStd.action":
            self._send_html(eams_form_page())
            return
        if path == "/__eams_table.html":
            self._send_html(eams_table_page())
            return
        if path == "/__empty.html":
            self._send_html(EMPTY_PAGE)
            return
        super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        posts.append({"path": self.path, "body": raw})
        self._send_html("<!doctype html><meta charset='utf-8'><title>已提交</title><body>ok</body>")


# ------------------------------------------------------------------ 注入层

def build_injected_script() -> str:
    """还原 ImportViewController.injectedScraper() 注入的那段脚本。"""
    source = os.path.join(APP_DIR, "ImportViewController.swift")
    wrapper = wlt.extract_raw_string(source, "return #\"\"\"")
    js_path = os.path.join(APP_DIR, "Scripts", "eams-scrape.js")
    with open(js_path, encoding="utf-8") as fh:
        scraper = fh.read()
    script = wrapper.replace("\\#(js)", scraper)
    if "\\#(js)" in script:
        raise SystemExit("注入层模板里还有未替换的插值")
    return script


HANDLER_STUB = """
window.__msgs = [];
window.webkit = { messageHandlers: {
  tt:       { postMessage: function(m){ window.__msgs.push(['tt', m]); } },
  store:    { postMessage: function(m){ window.__msgs.push(['store', m]); } },
  ttImport: { postMessage: function(m){ window.__msgs.push(['ttImport', m]); } }
}};
"""

BRIDGE_SHIM = None  # 运行时从 ImportViewController 里抽出来


def last_courses_message(page) -> dict | None:
    payloads = page.evaluate(
        """() => (window.__msgs || [])
            .filter(m => m[0] === 'ttImport' && m[1].t === 'courses')
            .map(m => m[1].s)"""
    )
    if not payloads:
        return None
    try:
        return json.loads(payloads[-1])
    except json.JSONDecodeError:
        return {"__raw": payloads[-1][:200]}


def debug_messages(page) -> list:
    raw = page.evaluate(
        """() => (window.__msgs || [])
            .filter(m => m[0] === 'ttImport' && m[1].t === 'debug')
            .map(m => m[1].s)"""
    )
    out = []
    for item in raw:
        try:
            out.append(json.loads(item))
        except json.JSONDecodeError:
            out.append({"__raw": item[:120]})
    return out


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        print("跳过端到端测试：playwright 不可用（%s）" % exc)
        return 0

    injected = build_injected_script()
    bridge = wlt.extract_raw_string(os.path.join(APP_DIR, "ImportViewController.swift"),
                                    "private static let bridgeShim = #\"\"\"")

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % port

    try:
        with sync_playwright() as pw:
            browser = pw.webkit.launch(headless=True)
            ctx = browser.new_context()

            def new_page():
                page = ctx.new_page()
                page.add_init_script(HANDLER_STUB)
                page.add_init_script(bridge)
                page.add_init_script(injected)
                return page

            # ---------- E1: 课表页解析 ----------
            page = new_page()
            page.goto(base + "/__eams_table.html")
            page.wait_for_timeout(2600)
            parsed = last_courses_message(page)
            record("e2e:table:message-arrived", parsed is not None, parsed and list(parsed)[:4])
            courses = (parsed or {}).get("courses") or []
            record("e2e:table:course-count", len(courses) == 2, len(courses))

            by_name = {c.get("name"): c for c in courses}
            math = by_name.get("高等数学") or {}
            record("e2e:table:teacher", math.get("teacher") == "张三", math.get("teacher"))
            record("e2e:table:day-start-end",
                   (math.get("day"), math.get("startPeriod"), math.get("endPeriod")) == (2, 3, 4),
                   [math.get("day"), math.get("startPeriod"), math.get("endPeriod")])
            record("e2e:table:weeks", math.get("weeks") == [1, 2, 3, 4, 5, 6, 7, 8], math.get("weeks"))
            record("e2e:table:room-campus",
                   (math.get("room"), math.get("campus")) == ("A101", "主校区"),
                   [math.get("room"), math.get("campus")])

            english = by_name.get("大学英语") or {}
            record("e2e:table:odd-weeks", english.get("weeks") == [1, 3, 5, 7, 9, 11, 13, 15],
                   english.get("weeks"))
            record("e2e:table:single-span", english.get("endPeriod") == english.get("startPeriod"),
                   [english.get("startPeriod"), english.get("endPeriod")])
            record("e2e:table:url-reported", "/__eams_table.html" in ((parsed or {}).get("url") or ""),
                   (parsed or {}).get("url"))
            debugs = debug_messages(page)
            record("e2e:table:debug-arrived", bool(debugs), len(debugs))
            if debugs:
                record("e2e:table:debug-frames", (debugs[-1].get("frames") or 0) >= 1,
                       debugs[-1].get("frames"))
                record("e2e:table:debug-titled", (debugs[-1].get("titled") or 0) == 2,
                       debugs[-1].get("titled"))

            # ---------- E2: 自动提交只发生一次 ----------
            posts.clear()
            page2 = new_page()
            page2.goto(base + "/eams/courseTableForStd.action")
            page2.wait_for_timeout(6000)
            record("e2e:submit:exactly-once", len(posts) == 1, [p["path"] for p in posts])
            if posts:
                fields = urllib.parse.parse_qs(posts[0]["body"], keep_blank_values=True)
                record("e2e:submit:ids-sent", fields.get("ids", [""])[0] == "2023010101", fields.get("ids"))
                record("e2e:submit:semester-sent", fields.get("semester.id", [""])[0] == "42",
                       fields.get("semester.id"))
                record("e2e:submit:target-path",
                       posts[0]["path"].endswith("courseTableForStd!courseTable.action"), posts[0]["path"])
            else:
                record("e2e:submit:ids-sent", False, "没有收到提交")
                record("e2e:submit:semester-sent", False, "没有收到提交")
                record("e2e:submit:target-path", False, "没有收到提交")

            # ---------- E3: 空页面不误报 ----------
            page3 = new_page()
            page3.goto(base + "/__empty.html")
            page3.wait_for_timeout(2000)
            empty = last_courses_message(page3)
            record("e2e:empty:no-courses", (empty or {}).get("courses") == [], empty)
            record("e2e:empty:ok-false", (empty or {}).get("ok") is False, (empty or {}).get("ok"))
            record("e2e:empty:debug", bool(debug_messages(page3)), len(debug_messages(page3)))

            browser.close()
    finally:
        server.shutdown()

    failed = [r for r in results if not r["pass"]]
    for r in results:
        mark = "PASS" if r["pass"] else "FAIL"
        line = "  [%s] %s" % (mark, r["name"])
        if r["detail"] is not None:
            line += "  <- %s" % (json.dumps(r["detail"], ensure_ascii=False)[:180],)
        print(line)
    print("\n端到端 %d 项，通过 %d 项，失败 %d 项"
          % (len(results), len(results) - len(failed), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())