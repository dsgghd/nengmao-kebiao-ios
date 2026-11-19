# -*- coding: utf-8 -*-
"""Generate four constructivist timetable style mockups (HTML only, no app code)."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

days = [('周一', '11.16', True), ('周二', '11.17', False), ('周三', '11.18', False),
        ('周四', '11.19', False), ('周五', '11.20', False), ('周六', '11.21', False),
        ('周日', '11.22', False)]
times = ['08:00', '08:55', '10:00', '10:55', '14:00', '14:55',
         '16:00', '16:55', '19:00', '19:55', '20:50']

# day, start, end, name, room, teacher, color, extra classes
courses = [
    (1, 1, 2, '高等数学', '崇文楼C202', '耿春梅', '#1F6F5C', ''),
    (1, 3, 4, '程序设计基础', '崇文楼A206', '赵改连', '#8A5A44', ''),
    (2, 1, 2, '大学英语', '崇文楼A113', '夏小维', '#2E4F7A', 'tilt-l'),
    (2, 3, 4, '机械制图', '崇思楼B315', '张歆伊', '#B07A24', 'tilt-r'),
    (3, 1, 2, '程序设计基础', '崇文楼A206', '赵改连', '#8A5A44', ''),
    (3, 5, 6, '思想道德与法治', '知行楼C201', '郭双燕', '#1F6F5C', 'accent-teal'),
    (3, 9, 11, '军事理论', '崇思楼A312', '冯晨迪', '#B07A24', 'accent-red'),
    (4, 1, 2, '机械制图', '崇思楼B315', '张歆伊', '#B07A24', 'tilt-r'),
    (4, 3, 4, '大学英语', '崇文楼A113', '夏小维', '#2E4F7A', 'tilt-l'),
    (5, 3, 4, '大学体育', '田径场', '陈婷婷', '#3E6B34', 'accent-mustard'),
    (5, 7, 8, '人工智能基础', '图书馆分室3', '赵婷婷', '#2E4F7A', ''),
]


def grid_html():
    parts = ['<div class="grid">']
    parts.append('<div class="corner">节次</div>')
    for i, (name, date, today) in enumerate(days):
        cls = 'day today' if today else 'day'
        parts.append(
            f'<div class="{cls}" style="grid-column:{i + 2};grid-row:1"><b>{name}</b><span>{date}</span></div>'
        )
    for p, t in enumerate(times, start=1):
        parts.append(
            f'<div class="period" style="grid-column:1;grid-row:{p + 1}"><b>{p}</b><span>{t}</span></div>'
        )
    for p in range(1, 12):
        for d in range(1, 8):
            today = ' today' if d == 1 else ''
            parts.append(
                f'<div class="cell{today}" style="grid-column:{d + 1};grid-row:{p + 1}"></div>'
            )
    for d, s, e, name, room, teacher, color, extra in courses:
        span = e - s + 1
        cls = ('course ' + extra).strip()
        parts.append(
            f'<div class="{cls}" style="grid-column:{d + 1};grid-row:{s + 1} / span {span};--c:{color}">'
            f'<b>{name}</b><span>{room}</span><small>{teacher}</small></div>'
        )
    parts.append('<div class="nowline" style="top:57%"><span>NOW 15:40</span></div>')
    parts.append('</div>')
    return '\n'.join(parts)


GRID = grid_html()

COMMON_BODY = '''<div class="canvas {CLS}">
  <header class="top">
    <div class="brand">
      <div class="mark">课</div>
      <div class="brandtext"><strong>课程表</strong><span>2026-2027学年第一学期</span></div>
    </div>
    <div class="weekblock">
      <div class="weeklabel">WEEK</div>
      <div class="weeknum">12</div>
      <div class="weekmeta">第 12 周 · 11.16 – 11.22</div>
    </div>
  </header>
  <div class="metaRow">
    <span class="dot"></span><span>示例同学 · 汽制2603</span>
    <span class="sep">/</span><span>今天 · 周一</span>
    <span class="sep">/</span><span>数据只保存在本机</span>
  </div>
  {GRID}
  <footer><span>WEEK 12 / 2026-2027</span><span>课程表 · 风格稿</span></footer>
</div>'''

BASE = '''*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1536px;height:1024px;overflow:hidden;background:#F2EEE3}
body{font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.canvas{width:1536px;height:1024px;position:relative;overflow:hidden;display:flex;flex-direction:column;padding:32px 40px 22px}
.top{display:flex;justify-content:space-between;align-items:flex-end;position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:14px;position:relative;z-index:2}
.brandtext strong{display:block;font-weight:900;letter-spacing:-.04em}
.brandtext span{display:block;margin-top:3px}
.weekblock{text-align:right;position:relative;z-index:2}
.weeklabel{font-weight:800;letter-spacing:.28em}
.weeknum{font-weight:900;line-height:.78;letter-spacing:-.06em}
.weekmeta{font-weight:700;margin-top:8px}
.metaRow{display:flex;align-items:center;gap:10px;position:relative;z-index:2}
.dot{width:8px;height:8px;flex:0 0 auto}
.sep{opacity:.35}
.grid{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:58px repeat(7,1fr);grid-template-rows:46px repeat(11,1fr)}
.corner,.day,.period,.cell{min-width:0;min-height:0}
.day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.day b{font-weight:900}
.day span{font-variant-numeric:tabular-nums}
.period{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.period b{font-weight:900;font-variant-numeric:tabular-nums}
.period span{font-variant-numeric:tabular-nums}
.course{position:relative;z-index:2;display:flex;flex-direction:column;gap:2px;overflow:hidden;min-width:0}
.course b{font-weight:900;line-height:1.2}
.course span,.course small{line-height:1.2;overflow:hidden;text-overflow:ellipsis}
.nowline{display:none;position:absolute;left:0;right:0;height:2px;z-index:3}
.nowline span{position:absolute;right:0;top:-17px;font-size:9px;font-weight:900;letter-spacing:.14em;padding:2px 5px}
footer{display:flex;justify-content:space-between;position:relative;z-index:2}
'''

CSS_A = '''
.a{background:#F2EEE3;color:#141414}
.a::before{content:"";position:absolute;left:0;top:0;width:10px;height:100%;background:#D33228;z-index:1}
.a .top{border-bottom:3px solid #141414;padding-bottom:18px}
.a .top::after{content:"";position:absolute;right:-40px;top:-32px;width:460px;height:150px;background:#D33228;clip-path:polygon(100% 0,100% 100%,0 100%);opacity:.96}
.a .mark{width:52px;height:52px;background:#D33228;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:900}
.a .brandtext strong{font-size:29px}
.a .brandtext span{font-size:12px;color:#5A5448}
.a .weeklabel{font-size:10px}
.a .weeknum{font-size:112px;color:transparent;-webkit-text-stroke:2.5px #141414}
.a .weekmeta{font-size:12px}
.a .metaRow{padding:12px 0;font-size:11px;color:#5A5448;letter-spacing:.02em;border-bottom:1px solid #CFC7B6}
.a .dot{background:#D33228}
.a .grid{gap:1px;background:#141414;border:2px solid #141414;margin-top:14px}
.a .corner,.a .day,.a .period,.a .cell{background:#FBF8F0}
.a .corner{background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:10px;font-weight:800}
.a .day b{font-size:15px}
.a .day span{font-size:10px;color:#7D7565}
.a .day.today{background:#D33228;color:#fff}
.a .day.today span{color:rgba(255,255,255,.8)}
.a .period b{font-size:15px}
.a .period span{font-size:9px;color:#7D7565}
.a .cell.today{background:#F7E4DE}
.a .course{margin:4px;padding:8px 9px;background:#FBF8F0;border:1.5px solid #141414;border-left:6px solid var(--c)}
.a .course b{font-size:15px}
.a .course span{font-size:11px;color:#4B463C}
.a .course small{font-size:9px;color:#7D7565}
.a footer{margin-top:12px;padding-top:10px;border-top:1px solid #141414;font-size:10px;font-weight:700;letter-spacing:.12em;color:#5A5448}
'''

CSS_B = '''
.b{background:#111;color:#F2EEE3}
.b::before{content:"";position:absolute;left:0;top:0;width:100%;height:10px;background:#E03A2F;z-index:3}
.b .top{border-bottom:1px solid #4A453D;padding-bottom:18px}
.b .top::after{content:"";position:absolute;right:-70px;top:-90px;width:360px;height:360px;background:#E03A2F;transform:rotate(45deg);opacity:.10}
.b .mark{width:52px;height:52px;background:#E03A2F;color:#111;display:grid;place-items:center;font-size:28px;font-weight:900}
.b .brandtext strong{font-size:29px}
.b .brandtext span{font-size:12px;color:#A49B8B;letter-spacing:.04em}
.b .weeklabel{font-size:10px;color:#E03A2F}
.b .weeknum{font-size:112px;color:transparent;-webkit-text-stroke:2.5px #E03A2F}
.b .weekmeta{font-size:12px;color:#C9C2B4}
.b .metaRow{padding:12px 0;font-size:11px;color:#8A8375;letter-spacing:.08em;border-bottom:1px solid #2A2722}
.b .dot{background:#E03A2F}
.b .grid{gap:1px;background:#3A3731;border:1px solid #3A3731;margin-top:14px}
.b .corner,.b .day,.b .period,.b .cell{background:#151515}
.b .corner{background:#0B0B0B;color:#8A8375;display:grid;place-items:center;font-size:10px;font-weight:800;letter-spacing:.12em}
.b .day b{font-size:15px;letter-spacing:.04em}
.b .day span{font-size:10px;color:#8A8375}
.b .day.today{background:#E03A2F;color:#111}
.b .day.today span{color:rgba(17,17,17,.72)}
.b .period b{font-size:15px;color:#F2EEE3}
.b .period span{font-size:9px;color:#8A8375}
.b .cell.today{background:#1C1514}
.b .course{margin:4px;padding:8px 9px;background:#181818;border:1px solid #4A453D;border-top:3px solid #E03A2F}
.b .course b{font-size:15px;color:#F2EEE3}
.b .course span{font-size:11px;color:#C9C2B4}
.b .course small{font-size:9px;color:#8A8375}
.b .nowline{display:block;background:#E03A2F}
.b .nowline span{background:#E03A2F;color:#111}
.b footer{margin-top:12px;padding-top:10px;border-top:1px solid #3A3731;font-size:10px;font-weight:700;letter-spacing:.16em;color:#8A8375}
'''

CSS_C = '''
.c{background:#F2EEE3;color:#141414}
.c::before{content:"";position:absolute;right:-90px;top:-120px;width:470px;height:470px;background:#C9912B;border-radius:50%;opacity:.95;z-index:0}
.c::after{content:"";position:absolute;left:0;top:0;width:100%;height:12px;background:#141414;z-index:3}
.c .top{border-bottom:3px solid #141414;padding-bottom:18px}
.c .top::before{content:"";position:absolute;left:-40px;bottom:-3px;width:560px;height:70px;background:#D33228;clip-path:polygon(0 100%,100% 0,100% 100%);opacity:.95;z-index:0}
.c .mark{width:56px;height:56px;background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:30px;font-weight:900;transform:rotate(-3deg)}
.c .brandtext strong{font-size:31px}
.c .brandtext span{font-size:12px;color:#4B463C}
.c .weeklabel{font-size:11px;color:#D33228;letter-spacing:.3em}
.c .weeknum{font-size:124px;color:#141414;position:relative;z-index:1}
.c .weeknum::before{content:"";position:absolute;right:-10px;bottom:6px;width:86px;height:20px;background:#D33228;z-index:-1}
.c .weekmeta{font-size:12px;font-weight:800}
.c .metaRow{padding:12px 0;font-size:11px;color:#4B463C;letter-spacing:.03em;border-bottom:1px solid #CFC7B6;position:relative;z-index:2}
.c .dot{background:#D33228}
.c .grid{gap:2px;background:#141414;border:3px solid #141414;margin-top:14px;z-index:2}
.c .corner,.c .day,.c .period,.c .cell{background:#FBF8F0}
.c .corner{background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:10px;font-weight:900}
.c .day b{font-size:15px}
.c .day span{font-size:10px;color:#7D7565}
.c .day.today{background:#D33228;color:#fff}
.c .day.today span{color:rgba(255,255,255,.8)}
.c .period b{font-size:15px}
.c .period span{font-size:9px;color:#7D7565}
.c .cell.today{background:#F7E4DE}
.c .course{margin:5px;padding:8px 9px;background:#FBF8F0;border:2px solid #141414;box-shadow:4px 4px 0 #141414;border-top:6px solid var(--c)}
.c .course b{font-size:15px}
.c .course span{font-size:11px;color:#4B463C}
.c .course small{font-size:9px;color:#7D7565}
.c .course.tilt-l{transform:rotate(-1.2deg)}
.c .course.tilt-r{transform:rotate(1.2deg)}
.c .course.accent-red{background:#D33228;color:#fff;box-shadow:4px 4px 0 #141414}
.c .course.accent-red span,.c .course.accent-red small{color:rgba(255,255,255,.78)}
.c .course.accent-mustard{background:#C9912B;color:#141414;box-shadow:4px 4px 0 #141414}
.c .course.accent-teal{background:#1F6F5C;color:#fff;box-shadow:4px 4px 0 #141414}
.c .course.accent-teal span,.c .course.accent-teal small{color:rgba(255,255,255,.78)}
.c footer{margin-top:12px;padding-top:10px;border-top:3px solid #141414;font-size:10px;font-weight:900;letter-spacing:.14em;color:#141414;z-index:2}
'''

CSS_D = '''
.d{background:#F7F3EA;color:#161616}
.d::before{content:"";position:absolute;left:0;top:0;width:3px;height:100%;background:#D94A35}
.d .top{border-bottom:1px solid #D94A35;padding-bottom:14px}
.d .mark{width:34px;height:34px;border:1.5px solid #161616;display:grid;place-items:center;font-size:18px;font-weight:900;background:transparent}
.d .brandtext strong{font-size:20px;letter-spacing:-.02em}
.d .brandtext span{font-size:10px;color:#6B6458;letter-spacing:.06em}
.d .weeklabel{font-size:10px;color:#D94A35}
.d .weeknum{font-size:118px;color:transparent;-webkit-text-stroke:2px #161616}
.d .weekmeta{font-size:11px;color:#6B6458}
.d .metaRow{padding:10px 0;font-size:10px;color:#6B6458;letter-spacing:.06em;border-bottom:1px solid #E2D9C8}
.d .dot{background:#D94A35}
.d .grid{gap:0;background:transparent;border-top:1px solid #161616;border-left:1px solid #161616;margin-top:16px}
.d .corner,.d .day,.d .period,.d .cell{background:transparent;border-right:1px solid #D8CFBE;border-bottom:1px solid #D8CFBE}
.d .corner{color:#6B6458;display:grid;place-items:center;font-size:9px;font-weight:700;letter-spacing:.1em}
.d .day b{font-size:13px;font-weight:800}
.d .day span{font-size:9px;color:#8A8175}
.d .day.today{background:#FBEDE8;border-bottom:2px solid #D94A35}
.d .period b{font-size:13px;font-weight:800}
.d .period span{font-size:8px;color:#8A8175}
.d .cell.today{background:#FBEDE8}
.d .course{margin:0;padding:8px 10px;background:#F7F3EA;border-left:2px solid #D94A35}
.d .course b{font-size:14px;font-weight:800;letter-spacing:.01em}
.d .course span{font-size:10px;color:#6B6458}
.d .course small{font-size:8px;color:#9A9083}
.d footer{margin-top:12px;padding-top:10px;border-top:1px solid #161616;font-size:9px;letter-spacing:.14em;color:#6B6458}
'''

styles = {'a': CSS_A, 'b': CSS_B, 'c': CSS_C, 'd': CSS_D}
titles = {
    'a': '纸感构成 / Paper Constructivism',
    'b': '黑底工业 / Black Industrial',
    'c': '海报拼贴 / Poster Collage',
    'd': '极简朱线 / Minimal Vermilion',
}

for key, css in styles.items():
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>{titles[key]}</title>
<style>{BASE}{css}</style>
</head><body>
{COMMON_BODY.replace('{CLS}', key).replace('{GRID}', GRID)}
</body></html>'''
    path = os.path.join(OUT, f'style-{key}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', path)