#!/usr/bin/env python3
"""用 headless Edge 实测网页层：注入脚本 + 真实 app.js。

Swift 里的注入脚本是字符串，Windows 上没有 WebKit，但脚本本身是标准 JS，
所以可以直接从 .swift 源码里按标记抽出来，在 Chromium(Edge) 里跑真行为测试：

  T1 语法     三个注入脚本都能被 new Function 解析（能挡住引号/转义写错）
  T2 http 镜像 localStorage 缺 key 时回填、已有的不覆盖、setItem/removeItem/clear
             写穿到原生、sessionStorage 的写入不会被误报
  T3 file 兜底 window.localStorage 被顶替成内存实现，seed/get/set/remove/clear/
             length/key 全部符合 Storage 语义
  T4 主桥      AndroidBridge 四个方法与 app.js 的调用签名一一对应（参数顺序/字段）
  T5 导入桥    frame/top/frames 身份字段、课程消息、debug 去重
  T6 真实页面  用本地 HTTP 服务起 Web/，在 iframe 里调用真正的 importAutoCourses，
             验证课程被写入 localStorage（tt.data.v1）且重复导入会合并而不是翻倍

用法: python tools/web_layer_tests.py [--keep]
"""
from __future__ import annotations

import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
APP_DIR = os.path.join(IOS_BUILD, "NengmaoKeBiao")
WEB_DIR = os.path.join(APP_DIR, "Web")

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]

results: list[dict] = []


def record(name: str, ok: bool, detail=None) -> None:
    results.append({"name": name, "pass": bool(ok), "detail": detail})


# ---------------------------------------------------------------- 抽取脚本

def extract_raw_string(path: str, marker: str) -> str:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    idx = text.find(marker)
    if idx < 0:
        raise SystemExit("%s 里找不到标记 %r" % (path, marker))
    start = text.find('#"""', idx)
    if start < 0:
        raise SystemExit("%s 里 %r 后面没有 #\"\"\" 原始字符串" % (path, marker))
    start += 4
    end = text.find('"""#', start)
    if end < 0:
        raise SystemExit("%s 里原始字符串没有闭合" % path)
    return text[start:end]


def load_snippets() -> dict:
    storage = os.path.join(APP_DIR, "WebStorage.swift")
    main = os.path.join(APP_DIR, "MainViewController.swift")
    imp = os.path.join(APP_DIR, "ImportViewController.swift")
    return {
        "mirror": extract_raw_string(storage, "static let httpMirrorTemplate = #\"\"\""),
        "polyfill": extract_raw_string(storage, "static let polyfillTemplate = #\"\"\""),
        "main_bridge": extract_raw_string(main, "private static let bridgeShim = #\"\"\""),
        "import_bridge": extract_raw_string(imp, "private static let bridgeShim = #\"\"\""),
    }


# ---------------------------------------------------------------- Edge 驱动

def find_edge() -> str:
    for path in EDGE_CANDIDATES:
        if os.path.isfile(path):
            return path
    raise SystemExit("找不到 Edge/Chrome；请设置 EDGE_BIN 环境变量")


def run_page(html: str, url: str | None = None, timeout: int = 90) -> str:
    """把 HTML 写到临时文件（或用给定 URL）后跑 headless 浏览器，返回 DOM 文本。"""
    edge = os.environ.get("EDGE_BIN") or find_edge()
    workdir = tempfile.mkdtemp(prefix="tt-edge-")
    try:
        args = [
            edge,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--allow-file-access-from-files",
            "--user-data-dir=" + os.path.join(workdir, "profile"),
            "--virtual-time-budget=6000",
            "--dump-dom",
        ]
        if url is None:
            page = os.path.join(workdir, "case.html")
            with open(page, "w", encoding="utf-8") as fh:
                fh.write(html)
            target = "file:///" + page.replace("\\", "/").lstrip("/")
        else:
            target = url
        args.append(target)
        proc = subprocess.run(args, capture_output=True, timeout=timeout)
        out = proc.stdout.decode("utf-8", "replace")
        if "RESULT:" not in out:
            raise SystemExit("页面没有产出结果（%d bytes 输出）\n%s" % (len(out), out[-2000:]))
        return out
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def parse_results(dom: str) -> list[dict]:
    match = re.search(r'<pre id="out">RESULT:(.*?)</pre>', dom, re.DOTALL)
    if not match:
        raise SystemExit("页面没有产出结果（找不到 <pre id=\"out\">RESULT:）\n%s" % dom[-2000:])
    blob = match.group(1)
    blob = blob.replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return json.loads(blob)


HARNESS_HEAD = """<!doctype html><meta charset="utf-8">
<script>
window.__r = [];
function ok(name, cond, detail){ window.__r.push({name:name, pass: !!cond, detail: detail === undefined ? null : detail}); }
window.__msgs = [];
window.webkit = { messageHandlers: {
  tt:       { postMessage: function(m){ window.__msgs.push(['tt', m]); } },
  store:    { postMessage: function(m){ window.__msgs.push(['store', m]); } },
  ttImport: { postMessage: function(m){ window.__msgs.push(['ttImport', m]); } }
}};
</script>
"""

HARNESS_TAIL = """<pre id="out"></pre>
<script>
document.getElementById('out').textContent = 'RESULT:' + JSON.stringify(window.__r);
</script>
"""


# ---------------------------------------------------------------- 各测试

def test_syntax(snippets: dict) -> None:
    body = """
var srcs = %s;
for (var i = 0; i < srcs.length; i++) {
  var name = srcs[i][0], src = srcs[i][1];
  var errMsg = null;
  try { new Function(src); } catch (e) { errMsg = String(e); }
  ok('syntax:' + name, errMsg === null, errMsg);
}
""" % json.dumps([[k, v] for k, v in snippets.items()])
    dom = run_page(HARNESS_HEAD + "<script>" + body + "</script>" + HARNESS_TAIL)
    results.extend(parse_results(dom))


def test_http_mirror(snippet: str) -> None:
    seed = {"tt.settings.v1": '{"school":"扬州职业技术大学"}', "tt.data.v1": "[]"}
    shim = snippet.replace("__TT_STORE_SEED__", json.dumps(seed, ensure_ascii=False))
    pre = """
try { localStorage.clear(); } catch (e) {}
try { localStorage.setItem('tt.data.v1', 'PRESERVED'); } catch (e) {}
"""
    body = r"""
function lastStore(){ for (var i = window.__msgs.length - 1; i >= 0; i--) { if (window.__msgs[i][0] === 'store') return window.__msgs[i][1]; } return null; }
function storeMsgs(){ return window.__msgs.filter(function(m){ return m[0] === 'store'; }); }
ok('http:seeded-count', window.__ttStoreSeeded === 1, window.__ttStoreSeeded);
ok('http:seed-filled-missing', localStorage.getItem('tt.settings.v1') === '{"school":"扬州职业技术大学"}', localStorage.getItem('tt.settings.v1'));
ok('http:existing-kept', localStorage.getItem('tt.data.v1') === 'PRESERVED', localStorage.getItem('tt.data.v1'));

var before = storeMsgs().length;
localStorage.setItem('tt.notes.v1', '{"a":1}');
var m = lastStore();
ok('http:set-mirrored', m && m.t === 'set' && m.k === 'tt.notes.v1' && m.v === '{"a":1}', m);
ok('http:no-extra-msg', storeMsgs().length === before + 1, storeMsgs().length - before);

localStorage.removeItem('tt.notes.v1');
m = lastStore();
ok('http:remove-mirrored', m && m.t === 'del' && m.k === 'tt.notes.v1', m);

var beforeClear = storeMsgs().length;
localStorage.clear();
m = lastStore();
ok('http:clear-mirrored', m && m.t === 'clear' && storeMsgs().length === beforeClear + 1, m);

var beforeSession = storeMsgs().length;
try { sessionStorage.setItem('scratch', 'x'); } catch (e) {}
ok('http:session-not-mirrored', storeMsgs().length === beforeSession, storeMsgs().length - beforeSession);
ok('http:installed-flag', window.__ttStoreMirror === true, window.__ttStoreMirror);
"""
    dom = run_page(HARNESS_HEAD + "<script>" + pre + "</script><script>" + shim + "</script><script>" + body + "</script>" + HARNESS_TAIL)
    results.extend(parse_results(dom))


def test_polyfill(snippet: str) -> None:
    weird = 'a"b\\c\n\td'
    seed = {"tt.settings.v1": '{"school":"示例"}', "weird": weird}
    shim = snippet.replace("__TT_STORE_SEED__", json.dumps(seed, ensure_ascii=False))
    body = r"""
var expectedWeird = __EXPECTED__;
var ls = window.localStorage;
ok('polyfill:installed', window.__ttStoreInstalled === true, window.__ttStoreInstalled);
ok('polyfill:same-object', ls === window.__ttStore, ls === window.__ttStore);
ok('polyfill:seed-read', ls.getItem('tt.settings.v1') === '{"school":"示例"}', ls.getItem('tt.settings.v1'));
ok('polyfill:escape-roundtrip', ls.getItem('weird') === expectedWeird, JSON.stringify(ls.getItem('weird')));
ok('polyfill:missing-null', ls.getItem('nope') === null, ls.getItem('nope'));

var base = window.__msgs.length;
ls.setItem('k1', 'v1');
var m = window.__msgs[window.__msgs.length - 1];
ok('polyfill:set-posted', m && m[0] === 'store' && m[1].t === 'set' && m[1].k === 'k1' && m[1].v === 'v1', m && m[1]);
ok('polyfill:set-readable', ls.getItem('k1') === 'v1', ls.getItem('k1'));
ok('polyfill:length', ls.length === 3, ls.length);

ls.removeItem('k1');
m = window.__msgs[window.__msgs.length - 1];
ok('polyfill:remove-posted', m && m[1].t === 'del' && m[1].k === 'k1', m && m[1]);
ok('polyfill:remove-effect', ls.getItem('k1') === null, ls.getItem('k1'));

var keys = [];
for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
ok('polyfill:key-api', keys.length === 2 && keys.indexOf('tt.settings.v1') >= 0, keys);

ls.clear();
m = window.__msgs[window.__msgs.length - 1];
ok('polyfill:clear-posted', m && m[1].t === 'clear', m && m[1]);
ok('polyfill:clear-effect', ls.length === 0, ls.length);
ok('polyfill:value-stringified', (ls.setItem('n', 5), ls.getItem('n') === '5'), ls.getItem('n'));
""".replace("__EXPECTED__", json.dumps(weird, ensure_ascii=False))
    dom = run_page(HARNESS_HEAD + "<script>" + shim + "</script><script>" + body + "</script>" + HARNESS_TAIL)
    results.extend(parse_results(dom))


def test_main_bridge(snippet: str) -> None:
    body = r"""
ok('bridge:android-present', !!window.AndroidBridge, typeof window.AndroidBridge);
var b = window.AndroidBridge;
b.startAutoImport('https://jw.example.edu/login', '扬州职业技术大学', 'EAMS');
var m = window.__msgs[window.__msgs.length - 1];
ok('bridge:auto', m && m[0] === 'tt' && m[1].t === 'auto' && m[1].url === 'https://jw.example.edu/login'
   && m[1].name === '扬州职业技术大学' && m[1].sys === 'EAMS', m && m[1]);

b.openExternal('https://example.com/a?b=1');
m = window.__msgs[window.__msgs.length - 1];
ok('bridge:open', m && m[1].t === 'open' && m[1].url === 'https://example.com/a?b=1', m && m[1]);

b.saveFile('课表.ics', 'BEGIN:VCALENDAR', 'text/calendar');
m = window.__msgs[window.__msgs.length - 1];
ok('bridge:save', m && m[1].t === 'save' && m[1].name === '课表.ics' && m[1].text === 'BEGIN:VCALENDAR'
   && m[1].mime === 'text/calendar', m && m[1]);

b.syncReminders('[{"id":"1","at":1700000000000}]');
m = window.__msgs[window.__msgs.length - 1];
ok('bridge:reminders', m && m[1].t === 'reminders' && JSON.parse(m[1].json)[0].id === '1', m && m[1]);
ok('bridge:null-safe', (b.startAutoImport(), true), null);
"""
    dom = run_page(HARNESS_HEAD + "<script>" + snippet + "</script><script>" + body + "</script>" + HARNESS_TAIL)
    results.extend(parse_results(dom))


def test_import_bridge(snippet: str) -> None:
    body = r"""
ok('import:bridge-present', !!window.EamsBridge, typeof window.EamsBridge);
window.EamsBridge.onCourses('{"courses":[{"name":"高等数学"}]}');
var m = window.__msgs[window.__msgs.length - 1];
ok('import:courses-wrapped', m && m[0] === 'ttImport' && m[1].t === 'courses'
   && typeof m[1].s === 'string' && m[1].s.indexOf('高等数学') > 0, m && m[1]);
ok('import:frame-id', /^top-/.test(m[1].frame), m[1].frame);
ok('import:top-flag', m[1].top === true, m[1].top);
ok('import:frames-count', m[1].frames >= 1, m[1].frames);

window.EamsBridge.onDebug('{"frames":2,"titled":1}');
var first = window.__msgs.filter(function(x){ return x[0] === 'ttImport' && x[1].t === 'debug'; }).length;
window.EamsBridge.onDebug('{"frames":2,"titled":1}');
var second = window.__msgs.filter(function(x){ return x[0] === 'ttImport' && x[1].t === 'debug'; }).length;
ok('import:debug-dedup', first === 1 && second === 1, [first, second]);
window.EamsBridge.onDebug('{"frames":3}');
var third = window.__msgs.filter(function(x){ return x[0] === 'ttImport' && x[1].t === 'debug'; }).length;
ok('import:debug-new-passed', third === 2, third);
"""
    dom = run_page(HARNESS_HEAD + "<script>" + snippet + "</script><script>" + body + "</script>" + HARNESS_TAIL)
    results.extend(parse_results(dom))


# ---------------------------------------------------------------- 真实页面

class StaticServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_handler(harness_html: bytes):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=WEB_DIR, **kwargs)

        def log_message(self, *args):  # 静音
            pass

        def do_GET(self):
            if self.path.split("?")[0] == "/__harness.html":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(harness_html)))
                self.end_headers()
                self.wfile.write(harness_html)
                return
            super().do_GET()

    return Handler


HARNESS_PAGE = """<!doctype html><meta charset="utf-8">
<body>
<script>
window.__r = [];
function ok(name, cond, detail){ window.__r.push({name:name, pass: !!cond, detail: detail === undefined ? null : detail}); }
var frame = document.createElement('iframe');
frame.style.width = '390px'; frame.style.height = '780px';
frame.src = '/index.html';
document.body.appendChild(frame);

var payload1 = { ok: true, courses: [
  { name: '高等数学', teacher: '张三', room: 'A101', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1,2,3] },
  { name: '大学英语', teacher: '李四', room: 'B202', day: 2, startPeriod: 3, endPeriod: 4, weeks: [1,2] }
] };
var payload2 = { ok: true, courses: [
  { name: '高等数学', teacher: '张三', room: 'A101', day: 1, startPeriod: 1, endPeriod: 2, weeks: [4] }
] };

function readData(w){
  var raw = w.localStorage.getItem('tt.data.v1');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return { __parseError: String(e) }; }
}

function finish(){
  document.getElementById('out').textContent = 'RESULT:' + JSON.stringify(window.__r);
}

function step1(){
  var w = frame.contentWindow, d = w.document;
  ok('app:loaded', !!w && !!d, !!w);
  ok('app:has-import', typeof w.importAutoCourses === 'function', typeof w.importAutoCourses);
  var welcome = d.getElementById('welcome');
  var app = d.getElementById('app');
  ok('app:welcome-first-run', !!welcome && !welcome.hidden && !!app && app.hidden, welcome ? welcome.hidden : 'missing');

  w.importAutoCourses(payload1);
  var confirmBtn = d.getElementById('confirmImport');
  ok('app:preview-shown', !!confirmBtn, d.getElementById('modalRoot') ? 'modalRoot present' : 'no modalRoot');
  ok('app:preview-modal-title', /识别结果/.test(d.getElementById('modalRoot').textContent || ''), null);
  var rows = d.querySelectorAll('.preview-row');
  ok('app:preview-rows', rows.length === 2, rows.length);
  var stat = d.querySelector('.stat b');
  ok('app:preview-stat-blocks', stat && String(stat.textContent).trim() === '2', stat && stat.textContent);

  ok('app:no-storage-before-confirm', readData(w) === null, readData(w) === null ? null : 'already written');
  if (!confirmBtn) { finish(); return; }
  confirmBtn.click();
  setTimeout(step2, 400);
}

function step2(){
  var w = frame.contentWindow, d = w.document;
  var data = readData(w);
  ok('app:storage-written', !!data, data ? Object.keys(data).slice(0, 6) : null);
  var blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
  ok('app:blocks-count', blocks.length === 2, blocks.length);
  var math = blocks.filter(function(b){ return b.name === '高等数学'; })[0];
  ok('app:block-fields', !!math && math.day === 1 && math.startPeriod === 1 && math.endPeriod === 2, math ? [math.day, math.startPeriod, math.endPeriod] : null);
  ok('app:block-weeks-array', !!math && Array.isArray(math.weeks) && math.weeks.join(',') === '1,2,3', math ? math.weeks : null);
  var app = d.getElementById('app');
  ok('app:app-visible', !!app && !app.hidden, app ? app.hidden : 'missing');
  ok('app:settings-persisted', !!w.localStorage.getItem('tt.settings.v1'), 'tt.settings.v1');

  w.importAutoCourses(payload2);
  var again = d.getElementById('confirmImport');
  ok('app:preview-second-time', !!again, !!again);
  if (!again) { finish(); return; }
  again.click();
  setTimeout(step3, 400);
}

function step3(){
  var w = frame.contentWindow;
  var data = readData(w);
  var blocks = data && Array.isArray(data.blocks) ? data.blocks : [];
  ok('app:reimport-replaces-not-duplicates', blocks.length === 1, blocks.length);
  var math = blocks[0] || {};
  ok('app:reimport-weeks-updated', Array.isArray(math.weeks) && math.weeks.join(',') === '4', math.weeks);
  var raw = w.localStorage.getItem('tt.data.v1') || '';
  ok('app:json-stable', raw.indexOf('blocks') > 0 && raw.length < 200000, raw.length);
  finish();
}

var started = false;
function run(){
  if (started) return;
  started = true;
  try { step1(); } catch (e) { ok('app:exception', false, String(e)); finish(); }
}
frame.onload = function(){ setTimeout(run, 300); };
setTimeout(run, 2000);
</script>
<pre id="out"></pre>
</body>
"""


def test_real_page() -> None:
    harness = HARNESS_PAGE.encode("utf-8")
    server = StaticServer(("127.0.0.1", 0), make_handler(harness))
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = "http://127.0.0.1:%d/__harness.html" % port
        dom = run_page("", url=url)
        results.extend(parse_results(dom))
    finally:
        server.shutdown()


# ---------------------------------------------------------------- main

def main() -> int:
    if not os.path.isdir(WEB_DIR):
        raise SystemExit("找不到 Web 目录: %s" % WEB_DIR)
    snippets = load_snippets()

    test_syntax(snippets)
    test_http_mirror(snippets["mirror"])
    test_polyfill(snippets["polyfill"])
    test_main_bridge(snippets["main_bridge"])
    test_import_bridge(snippets["import_bridge"])
    test_real_page()

    failed = [r for r in results if not r["pass"]]
    for r in results:
        mark = "PASS" if r["pass"] else "FAIL"
        line = "  [%s] %s" % (mark, r["name"])
        if not r["pass"] and r["detail"] is not None:
            line += "  <- %s" % (r["detail"],)
        print(line)

    print("\n共 %d 项，通过 %d 项，失败 %d 项" % (len(results), len(results) - len(failed), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())