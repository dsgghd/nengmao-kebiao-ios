# -*- coding: utf-8 -*-
"""Generate three cleaner C-direction timetable style boards: fewer lines, more color fields."""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

days = [('周一', '11.16', True), ('周二', '11.17', False), ('周三', '11.18', False),
        ('周四', '11.19', False), ('周五', '11.20', False), ('周六', '11.21', False),
        ('周日', '11.22', False)]
times = ['08:00', '08:55', '10:00', '10:55', '14:00', '14:55',
         '16:00', '16:55', '19:00', '19:55', '20:50']

# day, start, end, name, room, teacher, fill class
courses = [
    (1, 1, 2, '高等数学', '崇文楼C202', '耿春梅', 'fill-teal'),
    (1, 3, 4, '程序设计基础', '崇文楼A206', '赵改连', 'fill-pale-teal'),
    (2, 1, 2, '大学英语', '崇文楼A113', '夏小维', 'fill-black'),
    (2, 3, 4, '机械制图', '崇思楼B315', '张歆伊', 'fill-mustard'),
    (3, 1, 2, '程序设计基础', '崇文楼A206', '赵改连', 'fill-pale-teal'),
    (3, 5, 6, '思想道德与法治', '知行楼C201', '郭双燕', 'fill-red'),
    (3, 9, 11, '军事理论', '崇思楼A312', '冯晨迪', 'fill-pale-mustard'),
    (4, 1, 2, '机械制图', '崇思楼B315', '张歆伊', 'fill-mustard'),
    (4, 3, 4, '大学英语', '崇文楼A113', '夏小维', 'fill-black'),
    (5, 3, 4, '大学体育', '田径场', '陈婷婷', 'fill-pale-red'),
    (5, 7, 8, '人工智能基础', '图书馆分室3', '赵婷婷', 'fill-pale-teal'),
]


def grid_html(with_daybands=False, tilt=False):
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
    # color bands behind the timetable
    parts.append('<div class="periodband p-morning" style="grid-column:1/-1;grid-row:2/span 4"></div>')
    parts.append('<div class="periodband p-afternoon" style="grid-column:1/-1;grid-row:6/span 4"></div>')
    parts.append('<div class="periodband p-evening" style="grid-column:1/-1;grid-row:10/span 3"></div>')
    if with_daybands:
        for i, (_, _, today) in enumerate(days, start=1):
            cls = 'dayband'
            if today:
                cls += ' today'
            elif i in (3, 5, 7):
                cls += ' alt'
            parts.append(
                f'<div class="{cls}" style="grid-column:{i + 1};grid-row:2/-1"></div>'
            )
    # course color blocks
    tilt_cls = {5: ' tilt-l', 8: ' tilt-r'} if tilt else {}
    for idx, (d, s, e, name, room, teacher, fill) in enumerate(courses):
        span = e - s + 1
        cls = f'course {fill}{tilt_cls.get(idx, "")}'
        parts.append(
            f'<div class="{cls}" style="grid-column:{d + 1};grid-row:{s + 1} / span {span}">'
            f'<b>{name}</b><span>{room}</span><small>{teacher}</small></div>'
        )
    parts.append('</div>')
    return '\n'.join(parts)


COMMON = '''<div class="canvas {CLS}">
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
.grid{position:relative;flex:1;min-height:0;display:grid;grid-template-columns:58px repeat(7,1fr);grid-template-rows:46px repeat(11,1fr);margin-top:18px}
.periodband,.dayband{position:relative;z-index:0}
.corner,.day,.period{position:relative;z-index:3}
.day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.day b{font-weight:900}
.day span{font-variant-numeric:tabular-nums}
.period{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.period b{font-weight:900;font-variant-numeric:tabular-nums}
.period span{font-variant-numeric:tabular-nums}
.course{position:relative;z-index:2;display:flex;flex-direction:column;gap:3px;overflow:hidden;min-width:0;border:0;box-shadow:none}
.course b{font-weight:900;line-height:1.2}
.course span,.course small{line-height:1.2;overflow:hidden;text-overflow:ellipsis}
footer{display:flex;justify-content:space-between;position:relative;z-index:2}
.fill-teal{background:#1F6F5C;color:#fff}
.fill-teal span,.fill-teal small{color:rgba(255,255,255,.76)}
.fill-pale-teal{background:#D9E6E0;color:#141414}
.fill-pale-teal span,.fill-pale-teal small{color:rgba(20,20,20,.62)}
.fill-black{background:#141414;color:#F2EEE3}
.fill-black span,.fill-black small{color:rgba(242,238,227,.72)}
.fill-mustard{background:#C9912B;color:#141414}
.fill-mustard span,.fill-mustard small{color:rgba(20,20,20,.68)}
.fill-red{background:#D33228;color:#fff}
.fill-red span,.fill-red small{color:rgba(255,255,255,.76)}
.fill-pale-red{background:#F3D9D4;color:#141414}
.fill-pale-red span,.fill-pale-red small{color:rgba(20,20,20,.62)}
.fill-pale-mustard{background:#EFE0C2;color:#141414}
.fill-pale-mustard span,.fill-pale-mustard small{color:rgba(20,20,20,.62)}
'''

CSS_C1 = '''
.c1{background:#F2EEE3;color:#141414}
.c1::before{content:"";position:absolute;left:0;top:0;width:12px;height:100%;background:#D33228;z-index:1}
.c1::after{content:"";position:absolute;right:-190px;top:-270px;width:520px;height:520px;border-radius:50%;background:#C9912B;z-index:0}
.c1 .top{padding-bottom:20px}
.c1 .mark{width:56px;height:56px;background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:30px;font-weight:900}
.c1 .brandtext strong{font-size:32px}
.c1 .brandtext span{font-size:12px;color:#4B463C}
.c1 .weekblock{padding:6px 10px 4px 0}
.c1 .weeklabel{font-size:10px;color:#141414;position:relative;z-index:1}
.c1 .weeknum{font-size:132px;color:#141414;position:relative;z-index:1}
.c1 .weekmeta{font-size:12px;color:#141414;position:relative;z-index:1}
.c1 .metaRow{background:#F3D9D4;padding:10px 14px;font-size:11px;color:#4B463C;letter-spacing:.02em}
.c1 .dot{background:#D33228}
.c1 .corner{background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:10px;font-weight:800}
.c1 .day b{font-size:15px}
.c1 .day span{font-size:10px;color:#7D7565}
.c1 .day.today{background:#D33228;color:#fff}
.c1 .day.today span{color:rgba(255,255,255,.8)}
.c1 .period b{font-size:15px}
.c1 .period span{font-size:9px;color:#7D7565}
.c1 .p-morning{background:rgba(201,145,43,.055)}
.c1 .p-afternoon{background:rgba(31,111,92,.05)}
.c1 .p-evening{background:rgba(20,20,20,.035)}
.c1 .course{margin:7px 8px;padding:10px 12px;border-radius:0}
.c1 .course b{font-size:15px}
.c1 .course span{font-size:11px}
.c1 .course small{font-size:9px}
.c1 footer{margin-top:14px;padding-top:10px;font-size:10px;font-weight:800;letter-spacing:.12em;color:#4B463C}
.c1 footer span:first-child::before{content:"";display:inline-block;width:8px;height:8px;background:#D33228;margin-right:7px}
'''

CSS_C2 = '''
.c2{background:#F2EEE3;color:#141414}
.c2::before{content:"";position:absolute;left:0;top:0;width:12px;height:100%;background:#141414;z-index:1}
.c2 .top{padding-bottom:18px}
.c2 .mark{width:56px;height:56px;background:#D33228;color:#fff;display:grid;place-items:center;font-size:30px;font-weight:900}
.c2 .brandtext strong{font-size:32px}
.c2 .brandtext span{font-size:12px;color:#4B463C}
.c2 .weekblock{background:#D33228;color:#fff;padding:18px 26px 16px;min-width:330px}
.c2 .weeklabel{font-size:11px;color:rgba(255,255,255,.82)}
.c2 .weeknum{font-size:126px;color:#fff}
.c2 .weekmeta{font-size:12px;color:rgba(255,255,255,.86)}
.c2 .metaRow{background:#EFE0C2;padding:10px 14px;font-size:11px;color:#4B463C;letter-spacing:.02em}
.c2 .dot{background:#141414}
.c2 .corner{background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:10px;font-weight:800}
.c2 .day b{font-size:15px}
.c2 .day span{font-size:10px;color:#7D7565}
.c2 .day.today{background:#D33228;color:#fff}
.c2 .day.today span{color:rgba(255,255,255,.8)}
.c2 .period b{font-size:15px}
.c2 .period span{font-size:9px;color:#7D7565}
.c2 .p-morning{background:rgba(201,145,43,.06)}
.c2 .p-afternoon{background:rgba(31,111,92,.055)}
.c2 .p-evening{background:rgba(20,20,20,.04)}
.c2 .dayband.alt{background:rgba(20,20,20,.028)}
.c2 .dayband.today{background:rgba(211,50,40,.075)}
.c2 .course{margin:8px;padding:11px 13px;border-radius:0}
.c2 .course b{font-size:15px}
.c2 .course span{font-size:11px}
.c2 .course small{font-size:9px}
.c2 footer{margin-top:14px;background:#141414;color:#F2EEE3;padding:10px 14px;font-size:10px;font-weight:800;letter-spacing:.12em}
'''

CSS_C3 = '''
.c3{background:#F2EEE3;color:#141414}
.c3::before{content:"";position:absolute;left:0;top:0;width:12px;height:100%;background:#D33228;z-index:1}
.c3::after{content:"";position:absolute;right:0;top:0;width:420px;height:180px;background:#C9912B;clip-path:polygon(100% 0,100% 100%,0 0);z-index:0}
.c3 .top{padding-bottom:18px;align-items:stretch}
.c3 .brand{background:#141414;color:#F2EEE3;padding:16px 22px;gap:16px}
.c3 .mark{width:52px;height:52px;background:#D33228;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:900}
.c3 .brandtext strong{font-size:30px}
.c3 .brandtext span{font-size:11px;color:rgba(242,238,227,.72)}
.c3 .weekblock{background:#D33228;color:#fff;padding:16px 24px 14px;min-width:300px}
.c3 .weeklabel{font-size:10px;color:rgba(255,255,255,.82)}
.c3 .weeknum{font-size:116px;color:#fff}
.c3 .weekmeta{font-size:11px;color:rgba(255,255,255,.86)}
.c3 .metaRow{padding:10px 0;font-size:11px;color:#4B463C;letter-spacing:.02em}
.c3 .dot{background:#D33228}
.c3 .corner{background:#141414;color:#F2EEE3;display:grid;place-items:center;font-size:10px;font-weight:800}
.c3 .day b{font-size:15px}
.c3 .day span{font-size:10px;color:#7D7565}
.c3 .day.today{background:#D33228;color:#fff}
.c3 .day.today span{color:rgba(255,255,255,.8)}
.c3 .period b{font-size:15px}
.c3 .period span{font-size:9px;color:#7D7565}
.c3 .p-morning{background:rgba(201,145,43,.07)}
.c3 .p-afternoon{background:rgba(31,111,92,.065)}
.c3 .p-evening{background:rgba(20,20,20,.045)}
.c3 .dayband.alt{background:rgba(20,20,20,.035)}
.c3 .dayband.today{background:rgba(211,50,40,.09)}
.c3 .course{margin:7px 8px;padding:10px 12px;border-radius:0}
.c3 .course b{font-size:15px}
.c3 .course span{font-size:11px}
.c3 .course small{font-size:9px}
.c3 .course.tilt-l{transform:rotate(-1.2deg)}
.c3 .course.tilt-r{transform:rotate(1.2deg)}
.c3 footer{margin-top:14px;background:#D33228;color:#fff;padding:10px 14px;font-size:10px;font-weight:800;letter-spacing:.12em}
'''

variants = [
    ('c1', CSS_C1, False, False, 'C1 / 纯色块'),
    ('c2', CSS_C2, True, False, 'C2 / 色带分区'),
    ('c3', CSS_C3, True, True, 'C3 / 海报色块'),
]

for key, css, daybands, tilt, title in variants:
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>{title}</title>
<style>{BASE}{css}</style>
</head><body>
{COMMON.replace('{CLS}', key).replace('{GRID}', grid_html(daybands, tilt))}
</body></html>'''
    path = os.path.join(OUT, f'{key}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', path)