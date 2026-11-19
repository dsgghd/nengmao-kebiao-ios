# -*- coding: utf-8 -*-
"""G4 base + temporal saturation system for course blocks, with desaturated decorations."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_c_variants as base  # noqa: E402

OUT = HERE

# day, start, end, name, room, teacher, background, foreground, state, tag
courses = [
    (1, 1, 2, '汽车文化', '崇思楼A305', '强爱民', 'hsl(30, 8%, 84%)', '#3A3732', 'done', ''),
    (1, 5, 6, '高等数学', '崇文楼C202', '耿春梅', 'hsl(168, 9%, 84%)', '#3A3732', 'done', ''),
    (1, 7, 8, '实用英语1', '崇文楼A106', '夏小维', '#E03A2F', '#FFFFFF', 'next', '下一节 · 16:00'),
    (2, 1, 2, '大学英语', '崇文楼A113', '夏小维', 'hsl(0, 0%, 62%)', '#FFFFFF', 'soon', ''),
    (2, 3, 4, '机械制图', '崇思楼B315', '张歆伊', 'hsl(38, 45%, 58%)', '#141414', 'soon', ''),
    (3, 1, 2, '程序设计基础', '崇文楼A206', '赵改连', 'hsl(168, 32%, 70%)', '#141414', 'later', ''),
    (3, 5, 6, '思想道德与法治', '知行楼C201', '郭双燕', 'hsl(4, 36%, 72%)', '#141414', 'later', ''),
    (3, 9, 11, '军事理论', '崇思楼A312', '冯晨迪', 'hsl(38, 28%, 76%)', '#141414', 'later', ''),
    (4, 1, 2, '机械制图', '崇思楼B315', '张歆伊', 'hsl(38, 22%, 78%)', '#141414', 'later', ''),
    (4, 3, 4, '大学英语', '崇文楼A113', '夏小维', 'hsl(0, 0%, 78%)', '#141414', 'later', ''),
    (5, 3, 4, '大学体育', '田径场', '陈婷婷', 'hsl(150, 20%, 80%)', '#141414', 'far', ''),
    (5, 7, 8, '人工智能基础', '图书馆分室3', '赵婷婷', 'hsl(168, 16%, 82%)', '#141414', 'far', ''),
]

days = [('周一', '11.16', True), ('周二', '11.17', False), ('周三', '11.18', False),
        ('周四', '11.19', False), ('周五', '11.20', False), ('周六', '11.21', False),
        ('周日', '11.22', False)]
times = ['08:00', '08:55', '10:00', '10:55', '14:00', '14:55',
         '16:00', '16:55', '19:00', '19:55', '20:50']


def grid_html():
    parts = ['<div class="grid">']
    parts.append('<div class="corner">节次</div>')
    for i, (name, date, today) in enumerate(days):
        cls = 'day today' if today else 'day'
        parts.append(f'<div class="{cls}" style="grid-column:{i + 2};grid-row:1"><b>{name}</b><span>{date}</span></div>')
    for p, t in enumerate(times, start=1):
        parts.append(f'<div class="period" style="grid-column:1;grid-row:{p + 1}"><b>{p}</b><span>{t}</span></div>')
    parts.append('<div class="periodband p-morning" style="grid-column:1/-1;grid-row:2/span 4"></div>')
    parts.append('<div class="periodband p-afternoon" style="grid-column:1/-1;grid-row:6/span 4"></div>')
    parts.append('<div class="periodband p-evening" style="grid-column:1/-1;grid-row:10/span 3"></div>')
    for i, (_, _, today) in enumerate(days, start=1):
        cls = 'dayband'
        if today:
            cls += ' today'
        elif i in (3, 5, 7):
            cls += ' alt'
        parts.append(f'<div class="{cls}" style="grid-column:{i + 1};grid-row:2/-1"></div>')
    for d, s, e, name, room, teacher, bg, fg, state, tag in courses:
        span = e - s + 1
        cls = 'course ' + state
        parts.append(
            f'<div class="{cls}" style="grid-column:{d + 1};grid-row:{s + 1} / span {span};background:{bg};color:{fg}">'
            + (f'<span class="next-tag">{tag}</span>' if tag else '')
            + f'<b>{name}</b><span>{room}</span><small>{teacher}</small></div>'
        )
    parts.append('</div>')
    return '\n'.join(parts)


LEGEND = '''<div class="time-legend">
  <span><i class="tl-next"></i>下一节</span>
  <span><i class="tl-soon"></i>今天稍后/明天</span>
  <span><i class="tl-later"></i>本周后续</span>
  <span><i class="tl-done"></i>已结束</span>
</div>'''

CLUSTER = '<span class="shape-cluster"><i class="sc-square"></i><i class="sc-circle"></i><i class="sc-tri"></i></span>'

DECO = '<div class="deco"><div class="tri-mustard"></div><div class="square-red"></div><div class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'

C3_MUTED = base.CSS_C3.replace('#D33228', '#B85A4E')

OVERRIDES = '''
.c3 .course span,.c3 .course small{color:currentColor;opacity:.8}
.c3 .course.next{padding-top:24px}
.c3 .next-tag{position:absolute;top:6px;right:8px;z-index:4;background:#141414;color:#fff;font-size:8px;font-weight:900;letter-spacing:.04em;padding:2px 5px}
.c3 .metaRow{gap:9px}
.c3 .time-legend{margin-left:auto;display:flex;align-items:center;gap:13px;font-size:9px;color:#4B463C;letter-spacing:.02em;white-space:nowrap}
.c3 .time-legend i{display:inline-block;width:8px;height:8px;margin-right:4px;vertical-align:-1px}
.c3 .tl-next{background:#E03A2F}
.c3 .tl-soon{background:hsl(38,45%,58%)}
.c3 .tl-later{background:hsl(168,32%,70%)}
.c3 .tl-done{background:hsl(0,0%,84%)}
.c3 .shape-cluster{filter:saturate(.45);opacity:.5}
.c3 .deco{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;filter:saturate(.38);opacity:.42}
.c3 .tri-mustard{position:absolute;width:340px;height:340px;background:#C9912B;clip-path:polygon(100% 0,100% 100%,0 100%);right:50px;bottom:80px}
.c3 .square-red{position:absolute;width:122px;height:122px;border:3px solid #D33228;right:304px;bottom:240px;transform:rotate(10deg)}
.c3 .dots{position:absolute;right:300px;bottom:380px;display:grid;grid-template-columns:repeat(3,8px);gap:16px}
.c3 .dots i{width:8px;height:8px;background:#141414;border-radius:50%}
.c3::after{filter:saturate(.5);opacity:.35}
'''

OVERRIDES_T2 = '''
.c3 .shape-cluster{filter:saturate(.3);opacity:.3}
.c3 .deco{filter:saturate(.2);opacity:.24}
.c3::after{filter:saturate(.35);opacity:.22}
'''

COMMON_META = '''<div class="canvas c3">
  {DECO}
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
    <span class="sep">/</span><span>现在 15:40</span>
    {LEGEND}
  </div>
  {GRID}
  <footer><span>WEEK 12 / 2026-2027</span><span>课程表 · 时间饱和度稿</span></footer>
</div>'''

for key, title, extra in [
    ('t1', 'C3-G4-T1 / 时间饱和度 · 平衡版', ''),
    ('t2', 'C3-G4-T2 / 时间饱和度 · 弱装饰版', OVERRIDES_T2),
]:
    body = COMMON_META.replace('{DECO}', DECO).replace('{LEGEND}', LEGEND).replace('{GRID}', grid_html())
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>{title}</title>
<style>{base.BASE}{C3_MUTED}{OVERRIDES}{extra}</style>
</head><body>
{body}
</body></html>'''
    path = os.path.join(OUT, f'c3-g4-{key}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', path)