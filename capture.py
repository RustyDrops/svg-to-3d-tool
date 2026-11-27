#!/usr/bin/env python3
"""Capture harness: renders each exam case with chrome-headless-shell,
saves a PNG per case and a JSON report of window.__examResult."""
import json, sys, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8901"
OUT = os.path.expanduser("~/workspace/svg-to-3d-tool/renders")
os.makedirs(OUT, exist_ok=True)
tag = sys.argv[1] if len(sys.argv) > 1 else "v1"
cases = sys.argv[2].split(",") if len(sys.argv) > 2 else [f"e{i}" for i in range(1, 9)]

report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"),
        args=["--use-gl=angle", "--use-angle=swiftshader",
              "--enable-unsafe-swiftshader", "--no-sandbox"])
    for case in cases:
        page = browser.new_page(viewport={"width": 1000, "height": 650})
        msgs = []
        page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
        try:
            page.goto(f"{BASE}/index.html?exam={case}", wait_until="load", timeout=30000)
            page.wait_for_function("window.__ready === true", timeout=30000)
            page.wait_for_timeout(400)
            result = page.evaluate("window.__examResult || null")
            page.screenshot(path=os.path.join(OUT, f"{case}-{tag}.png"))
        except Exception as e:
            result = {"harnessError": str(e)}
        report[case] = {"result": result, "console": msgs[:12]}
        print(case, json.dumps(result)[:300])
    browser.close()

with open(os.path.join(OUT, f"report-{tag}.json"), "w") as f:
    json.dump(report, f, indent=1)
print("saved", os.path.join(OUT, f"report-{tag}.json"))
