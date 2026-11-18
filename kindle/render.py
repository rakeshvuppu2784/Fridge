"""Render kindle.html into Kindle-ready PNGs (8-bit greyscale, 16 levels, 600x800 native panel).
Usage: python render.py <site_dir> <out.png> [query] [chrome_path]
Writes <out.png>            = LANDSCAPE layout (800x600) rotated 90 deg clockwise, for a Kindle
                              standing sideways with its USB port on the RIGHT
       <out>-portrait.png   = PORTRAIT layout (600x800), in case the Kindle is stood upright again
To switch the Kindle back to portrait: point PANEL_URL in panel/local.sh at the -portrait.png file.
For a Kindle with the port on the LEFT, change ROTATE to -90.
"""
import sys, http.server, threading, functools, subprocess
from playwright.sync_api import sync_playwright

ROTATE = 90
site, out = sys.argv[1], sys.argv[2]
query = sys.argv[3] if len(sys.argv) > 3 else "demo=1"
chrome = sys.argv[4] if len(sys.argv) > 4 else None
base = out[:-4] if out.endswith(".png") else out
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site)
Handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_port}/kindle.html?{query}"

def grey(src, dst, rotate=0):
    cmd = ["convert", src]
    if rotate: cmd += ["-rotate", str(rotate)]
    cmd += ["-colorspace", "Gray", "-dither", "FloydSteinberg", "-colors", "16", "-depth", "8",
            "-define", "png:color-type=0", dst]
    subprocess.run(cmd, check=True)

with sync_playwright() as p:
    b = p.chromium.launch(**({"executable_path": chrome} if chrome else {}))
    for w, h, extra, shot in ((800, 600, "&land=1", base + ".land.rgb.png"), (600, 800, "", base + ".port.rgb.png")):
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1,
                        timezone_id="Asia/Kolkata", locale="en-IN")
        pg.goto(url + extra)
        pg.wait_for_function("window.__ready === true", timeout=60000)
        pg.wait_for_timeout(500)
        pg.screenshot(path=shot)
        pg.close()
    b.close()
srv.shutdown()
grey(base + ".land.rgb.png", out, ROTATE)
grey(base + ".port.rgb.png", base + "-portrait.png")
