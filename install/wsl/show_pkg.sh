#!/usr/bin/env bash
set -uo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 >/dev/null 2>&1
fi
python3 - <<'PY'
import json
d = json.load(open('/tmp/pkg.json'))
print('package   :', d.get('name'))
print('products  :', [(p.get('name'), p.get('type')) for p in d.get('products', [])])
for t in d.get('targets', []):
    print('target    :', t.get('name'), '| path:', t.get('path'), '| exclude:', t.get('exclude'))
print('platforms :', d.get('platforms'))
PY