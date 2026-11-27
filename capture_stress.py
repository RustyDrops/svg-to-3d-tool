#!/usr/bin/env python3
import json, sys, os
from playwright.sync_api import sync_playwright
BASE = "http://127.0.0.1:8901"
OUT = os.path.expanduser("~/workspace/svg-to-3d-tool/renders")
tag = sys.argv[1] if len(sys.argv) > 1 else "s1"
cases = {
 "s1": ("stress/s1-gears.svg", "S1: Two meshing gears, teeth, spoke holes, hub pins."),
 "s2": ("stress/s2-mandala.svg", "S2: Mandala medallion, 36 petals in 3 rings, 12 pierced holes, gem centre."),
 "s3": ("stress/s3-knight.svg", "S3: Knight, plume, visor slits, cape, shield, sword, recessed armour lines."),
 "s4": ("stress/s4-key.svg", "S4: Ornate key, pierced bow, collars, teeth, engraved swirls, perforated tag."),
 "s5": ("stress/s5-tree.svg", "S5: Tree, 55 leaf circles, 7 apples, grass strokes."),
 "s6": ("stress/s6-ship.svg", "S6: Pirate ship, sails, rigging strokes, portholes, waves."),
}
report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"),
        args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"])
    for case, (f, cap) in cases.items():
        page = browser.new_page(viewport={"width":1000,"height":650})
        msgs = []
        page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
        try:
            page.goto(f"{BASE}/stress.html?svg={f}&cap={cap}", wait_until="load", timeout=30000)
            page.wait_for_function("window.__ready === true", timeout=60000)
            page.wait_for_timeout(400)
            result = page.evaluate("window.__examResult || null")
            page.screenshot(path=os.path.join(OUT, f"{case}-{tag}.png"))
        except Exception as e:
            result = {"harnessError": str(e)}
        report[case] = {"result": result, "pageerrors": msgs[:5]}
        print(case, json.dumps(result)[:400])
        page.close()
    browser.close()
with open(os.path.join(OUT, f"report-stress-{tag}.json"), "w") as fh:
    json.dump(report, fh, indent=1)
print("saved")
