import json
import os
import sys

VENDOR = r"C:\Users\Administrator\Documents\Qoder\2026-11-16\2b4fcef7\ios-build\.tools-py"
sys.path.insert(0, VENDOR)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", os.path.join(VENDOR, "pw-browsers"))

from playwright.sync_api import sync_playwright  # noqa: E402

URL = "https://kebiao-ivoefg6tvfc.qoder.zone/"
out = {}

with sync_playwright() as pw:
    browser = pw.webkit.launch(headless=True)
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        ignore_https_errors=True,
        user_agent=("Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"),
    )
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="domcontentloaded", timeout=45000)
    page.wait_for_timeout(2500)

    out["title"] = page.title()
    out["has_import"] = page.evaluate("() => typeof window.importAutoCourses === 'function'")
    out["xlsx"] = page.evaluate("() => typeof XLSX")
    out["sw_supported"] = page.evaluate("() => 'serviceWorker' in navigator")
    out["manifest"] = page.evaluate("() => { var l = document.querySelector('link[rel=manifest]'); return l ? l.href : null; }")
    try:
        out["sw_state"] = page.evaluate(
            """async () => {
                const r = await navigator.serviceWorker.getRegistration();
                if (!r) return 'none';
                return r.active ? 'active' : (r.installing ? 'installing' : 'waiting');
            }"""
        )
        out["caches"] = page.evaluate("async () => await caches.keys()")
    except Exception as exc:  # noqa: BLE001
        out["sw_error"] = str(exc)[:120]

    out["js_errors"] = errors

    # 离线回放：模拟"装到桌面后没网也能开"
    try:
        ctx.set_offline(True)
        page.reload(wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(1500)
        out["offline_title"] = page.title()
        out["offline_has_welcome"] = page.evaluate("() => !!document.getElementById('welcome')")
        out["offline_has_import"] = page.evaluate("() => typeof window.importAutoCourses === 'function'")
    except Exception as exc:  # noqa: BLE001
        out["offline_error"] = str(exc)[:160]

    browser.close()

print(json.dumps(out, ensure_ascii=False, indent=2))