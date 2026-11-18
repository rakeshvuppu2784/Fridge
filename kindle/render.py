"""Render kindle.html to a Kindle-ready PNG (600x800, 8-bit greyscale, 16 levels).
Usage: python render.py <site_dir> <out.png> [query]   e.g. query="api=...&key=..." or "demo=1&fam=1"
"""
import sys, http.server, threading, functools, subprocess
from playwright.sync_api import sync_playwright

site, out = sys.argv[1], sys.argv[2]
query = sys.argv[3] if len(sys.argv) > 3 else "demo=1"
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site)
Handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/kindle.html?{query}"

with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": sys.argv[4]} if len(sys.argv) > 4 else {}))
    pg = b.new_page(viewport={"width": 600, "height": 800}, device_scale_factor=1,
                    timezone_id="Asia/Kolkata", locale="en-IN")
    pg.goto(url)
    pg.wait_for_function("window.__ready === true", timeout=60000)
    pg.wait_for_timeout(500)
    pg.screenshot(path=out + ".rgb.png")
    b.close()
srv.shutdown()
# greyscale, 16 levels (Kindle 8th gen panel), no alpha: what the Kindle's eips tool expects
subprocess.run(["convert", out + ".rgb.png", "-colorspace", "Gray", "-dither", "FloydSteinberg",
                "-colors", "16", "-depth", "8", "-define", "png:color-type=0", out], check=True)
