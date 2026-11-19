# -*- coding: utf-8 -*-
"""C3 base + three restrained constructivist geometric decoration sets."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_c_variants as base  # noqa: E402

OUT = HERE

CLUSTER = '<span class="shape-cluster"><i class="sc-square"></i><i class="sc-circle"></i><i class="sc-tri"></i></span>'

CLUSTER_CSS = '''
.c3 .metaRow{position:relative}
.c3 .shape-cluster{margin-left:auto;display:flex;align-items:center;gap:8px}
.c3 .shape-cluster i{display:block;flex:0 0 auto}
.c3 .sc-square{width:10px;height:10px;background:#D33228}
.c3 .sc-circle{width:12px;height:12px;border-radius:50%;background:#141414}
.c3 .sc-tri{width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:11px solid #C9912B}
'''

DECO = {
    'g1': {
        'title': 'C3-G1 / 环形 + 圆点',
        'html': '<div class="deco"><div class="ring-big"></div><div class="quarter-red"></div></div>',
        'css': '''
.c3 .deco{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.c3 .ring-big{position:absolute;width:460px;height:460px;border:3px solid #141414;border-radius:50%;right:-120px;bottom:20px;opacity:.85}
.c3 .quarter-red{position:absolute;width:230px;height:230px;background:#D33228;border-radius:50% 0 0 0;right:110px;bottom:120px;opacity:.95}
''',
    },
    'g2': {
        'title': 'C3-G2 / 三角 + 方框',
        'html': '<div class="deco"><div class="tri-mustard"></div><div class="square-red"></div></div>',
        'css': '''
.c3 .deco{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.c3 .tri-mustard{position:absolute;width:320px;height:320px;background:#C9912B;clip-path:polygon(100% 0,100% 100%,0 100%);right:60px;bottom:90px;opacity:.95}
.c3 .square-red{position:absolute;width:150px;height:150px;border:3px solid #D33228;right:390px;bottom:170px;transform:rotate(12deg);opacity:.95}
''',
    },
    'g3': {
        'title': 'C3-G3 / 半圆 + 点阵',
        'html': '<div class="deco"><div class="semi-mustard"></div><div class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="ring-top"></div></div>',
        'css': '''
.c3 .deco{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.c3 .semi-mustard{position:absolute;width:420px;height:210px;background:#C9912B;border-radius:210px 210px 0 0;right:-30px;bottom:80px;opacity:.95}
.c3 .dots{position:absolute;right:330px;bottom:330px;display:grid;grid-template-columns:repeat(3,8px);gap:16px}
.c3 .dots i{width:8px;height:8px;background:#141414;border-radius:50%}
.c3 .ring-top{position:absolute;width:260px;height:260px;border:2px solid #141414;border-radius:50%;right:10px;top:40px;opacity:.9}
''',
    },
}

for key, item in DECO.items():
    body = base.COMMON.replace('{CLS}', 'c3').replace('{GRID}', base.grid_html(True, True))
    # insert decoration layer right after the canvas opening div
    body = body.replace('<div class="canvas c3">', '<div class="canvas c3">' + item['html'])
    # add a tiny geometric signature at the right end of the meta row
    body = body.replace('<span class="sep">/</span><span>数据只保存在本机</span>',
                        '<span class="sep">/</span><span>数据只保存在本机</span>' + CLUSTER)
    html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>{item['title']}</title>
<style>{base.BASE}{base.CSS_C3}{CLUSTER_CSS}{item['css']}</style>
</head><body>
{body}
</body></html>'''
    path = os.path.join(OUT, f'c3-{key}.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('wrote', path)