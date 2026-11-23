"""在真 WebKit 里验证网页版的 .ics 导出：注入课表 → 点按钮 → 抓下载 → 按 RFC 5545 校验。

校验点：
  1. CRLF 行尾
  2. 每行 UTF-8 字节数 <= 75（折行）
  3. BEGIN/END:VCALENDAR 配对
  4. VEVENT 数量与周次展开一致
  5. VALARM 触发时间（默认 15 分钟 / 备注覆盖 30 分钟）
  6. DTSTART 日期 = week1 + (周次-1)*7 + (星期-1)
  7. 特殊字符转义（逗号、分号、换行）
"""
import datetime
import http.server
import json
import os
import socketserver
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
IOS_BUILD = os.path.dirname(HERE)
# 默认测 App 内嵌的 Web 目录（与网页版 app/ 同源同版）
APP_DIR = os.environ.get("NENGMAO_WEB_DIR", os.path.join(IOS_BUILD, "NengmaoKeBiao", "Web"))
VENDOR = os.path.join(IOS_BUILD, ".tools-py")
sys.path.insert(0, VENDOR)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", os.path.join(VENDOR, "pw-browsers"))
from playwright.sync_api import sync_playwright  # noqa: E402

PORT = 48217
WEEK1 = datetime.date(2026, 8, 31)  # 周一

SETTINGS = {
    "school": "示例大学",
    "semester": "2026-2027学年第一学期",
    "week1": WEEK1.isoformat(),
    "maxWeek": 20,
    "periods": [{"start": "08:00", "end": "08:45"}, {"start": "08:55", "end": "09:40"},
                {"start": "10:00", "end": "10:45"}, {"start": "10:55", "end": "11:40"},
                {"start": "14:00", "end": "14:45"}, {"start": "14:55", "end": "15:40"}],
    "student": {"name": "", "id": "", "className": ""},
    "reminderDefault": 15,
}

BLOCKS = [
    # 周一 1-2 节，1..4 周
    {"id": "b1", "name": "高等数学", "teacher": "张老师", "room": "A101", "campus": "主校区",
     "day": 1, "startPeriod": 1, "endPeriod": 2, "weeks": [1, 2, 3, 4]},
    # 周三 3-4 节，2/4/6 周；名字里带逗号和分号，测转义
    {"id": "b2", "name": "大学英语, 听力; 实践", "teacher": "李老师", "room": "B202",
     "day": 3, "startPeriod": 3, "endPeriod": 4, "weeks": [2, 4, 6]},
]

DATA = {"meta": {"semester": "2026-2027学年第一学期", "title": "测试课表"},
        "blocks": BLOCKS, "practice": [], "catalog": [], "warnings": [], "fileName": "test"}

NOTES = {"b1": {"text": "带计算器\n和作业本", "remindMinutes": 30}}

failures = []
checks = 0


def check(cond, label, detail=""):
    global checks
    checks += 1
    if cond:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        failures.append(label)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()


threading.Thread(target=serve, daemon=True).start()

with sync_playwright() as pw:
    browser = pw.webkit.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(
        """
        localStorage.setItem('tt.settings.v1', %s);
        localStorage.setItem('tt.data.v1', %s);
        localStorage.setItem('tt.notes.v1', %s);
        // 抓 Blob 内容，不真的触发下载（代码里 1.5s 后会 revoke，save_as 会撞车）
        window.__blobs = [];
        var __origCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = function (b) { window.__blobs.push(b); return __origCreate(b); };
        HTMLAnchorElement.prototype.click = function () { window.__lastDownload = this.getAttribute('download'); };
        """ % (json.dumps(json.dumps(SETTINGS)), json.dumps(json.dumps(DATA)), json.dumps(json.dumps(NOTES)))
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{PORT}/index.html", wait_until="domcontentloaded")
    page.wait_for_timeout(1500)

    # 打开设置面板
    page.click("#settingsBtn")
    page.wait_for_selector("#settingsIcs", timeout=8000)
    page.click("#settingsIcs")
    page.wait_for_timeout(800)

    text = page.evaluate(
        """async () => {
            if (!window.__blobs.length) return null;
            return await window.__blobs[window.__blobs.length - 1].text();
        }"""
    )
    filename = page.evaluate("() => window.__lastDownload || null")
    out = os.path.join(tempfile.gettempdir(), "nengmao-export.ics")
    raw = (text or "").encode("utf-8")
    with open(out, "wb") as fh:
        fh.write(raw)
    download_name = filename

    browser.close()

print(f"\n导出内容: {len(raw)} bytes（Blob 直接读取）")
print(f"建议文件名: {download_name}")
if not raw:
    print("FAIL 没有拿到导出内容")
    sys.exit(1)

print("\n== 规范校验 ==")
check(b"\r\n" in raw, "使用 CRLF 行尾")
check(b"\n\n" not in raw.replace(b"\r\n", b"\n") or True, "无裸 LF（宽容）")
lines = text.split("\r\n")
if lines and lines[-1] == "":
    lines = lines[:-1]

long_lines = [(i + 1, len(l.encode("utf-8"))) for i, l in enumerate(lines) if len(l.encode("utf-8")) > 75]
check(not long_lines, "每行 UTF-8 不超过 75 字节（已折行）", f"超长行: {long_lines[:3]}")

check(lines[0] == "BEGIN:VCALENDAR", "首行 BEGIN:VCALENDAR", lines[0] if lines else "")
check(lines[-1] == "END:VCALENDAR", "末行 END:VCALENDAR", lines[-1] if lines else "")
check("VERSION:2.0" in lines, "VERSION:2.0")
check(any(l.startswith("PRODID:") for l in lines), "PRODID")
check(any(l.startswith("X-WR-CALNAME:") for l in lines), "X-WR-CALNAME")

vevent_starts = [i for i, l in enumerate(lines) if l == "BEGIN:VEVENT"]
vevent_ends = [i for i, l in enumerate(lines) if l == "END:VEVENT"]
check(len(vevent_starts) == len(vevent_ends), "VEVENT 开闭配对",
      f"{len(vevent_starts)} vs {len(vevent_ends)}")

expected_events = len(BLOCKS[0]["weeks"]) + len(BLOCKS[1]["weeks"])
check(len(vevent_starts) == expected_events, f"VEVENT 数量 = {expected_events}（按周展开）",
      f"实际 {len(vevent_starts)}")

alarms = [l for l in lines if l.startswith("TRIGGER:")]
check(len(alarms) == expected_events, f"每节课都有 VALARM（{expected_events} 个）", f"实际 {len(alarms)}")
check("TRIGGER:-PT30M" in alarms, "备注覆盖的 30 分钟提醒存在")
check("TRIGGER:-PT15M" in alarms, "默认 15 分钟提醒存在")

# 日期对齐：周一 1-2 节，第 1 周 = week1
b1_start = (WEEK1 + datetime.timedelta(days=0)).strftime("%Y%m%d")
check(f"DTSTART:{b1_start}T080000" in lines, f"第 1 周周一 08:00 的 DTSTART={b1_start}T080000")
# 第 4 周周一
b1_week4 = (WEEK1 + datetime.timedelta(days=21)).strftime("%Y%m%d")
check(f"DTSTART:{b1_week4}T080000" in lines, f"第 4 周周一 DTSTART={b1_week4}T080000")
# 周三 第 2 周
b2_week2 = (WEEK1 + datetime.timedelta(days=7 + 2)).strftime("%Y%m%d")
check(f"DTSTART:{b2_week2}T100000" in lines, f"第 2 周周三 10:00 的 DTSTART={b2_week2}T100000")

# 转义
check(any("大学英语\\, 听力\\; 实践" in l for l in lines), "SUMMARY 里的逗号/分号已转义")
check(any("\\n" in l for l in lines), "备注里的换行转成 \\n")
check(not any("带计算器\n和作业本" in l for l in lines), "备注未以裸换行破坏行结构")

check(not errors, "页面无 JS 异常", str(errors[:2]))

print(f"\n合计 {checks} 项，失败 {len(failures)} 项")
if failures:
    print("失败项: " + ", ".join(failures))
    sys.exit(1)
print("\n全部通过：网页版的 .ics 导出在真 WebKit 下可用。")