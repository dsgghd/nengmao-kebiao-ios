# -*- coding: utf-8 -*-
"""T3: original G4 header/footer, temporal course saturation, frosted-glass in-grid decoration."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_c_variants as base  # noqa: E402
import make_c3_temporal as temporal  # noqa: E402

OUT = HERE

FROST_CSS = '''
.c3 .deco{filter:blur(6px) saturate(.5);opacity:.62}
.c3 .frost{
  position:absolute;right:-50px;bottom:10px;width:600px;height:680px;z-index:1;pointer-events:none;
  background:rgba(247,243,234,.07);
  -webkit-backdrop-filter:blur(10px) saturate(.75);
  backdrop-filter:blur(10px) saturate(.75);
  -webkit-mask-image:radial-gradient(ellipse at 55% 55%, #000 38%, transparent 80%);
  mask-image:radial-gradient(ellipse at 55% 55%, #000 38%, transparent 80%);
}
.c3 .frost::after{
  content:"";position:absolute;inset:0;
  background:linear-gradient(120deg,rgba(255,255,255,.08),transparent 60%);
}
.c3::after{filter:none;opacity:1}
'''

# T3 uses the original C3 brand colors; only the in-grid decorations are treated.
body = temporal.COMMON_META.replace('{DECO}', temporal.DECO + '<div class="frost"></div>')
body = body.replace('{LEGEND}', temporal.LEGEND).replace('{GRID}', temporal.grid_html())

html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>C3-G4-T3 / 网格内毛玻璃装饰</title>
<style>{base.BASE}{base.CSS_C3}{temporal.OVERRIDES}{FROST_CSS}</style>
</head><body>
{body}
</body></html>'''

path = os.path.join(OUT, 'c3-g4-t3.html')
with open(path, 'w', encoding='utf-8') as f:
    f.write(html)
print('wrote', path)