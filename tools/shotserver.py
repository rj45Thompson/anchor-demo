#!/usr/bin/env python3
"""Static server for anchor-demo that also lets a page SAVE ITS OWN FRAMES to disk.

Why this exists rather than screenshotting the browser: a browser pane that is not being painted -
because another window is in front of it - suspends requestAnimationFrame AND refuses to produce a
screenshot. Measured here: 0 rendered frames in 1.5 s while the game sat in state 'play', which
looked exactly like "the resume letters never spawn" and was nothing of the kind. A still frame of
a stopped game is indistinguishable from a running one, so both halves of that had to be fixed:
the game is stepped by hand (window.__bx.step), and the frame it produces is written straight to a
file by the page itself instead of being captured from outside.

    py tools/shotserver.py [port]           # default 8794, serves D:/code/anchor-demo

    PUT /_shot/<name>.png   body = a data: URL or raw base64   ->  writes _shots/<name>.png

Only .png and .jpg land, only under _shots/, and the name is stripped to a bare filename - a
path-traversal in a name would be a write-anywhere primitive on this machine.
"""
import base64
import http.server
import os
import re
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "_shots"
SAFE = re.compile(r"^[A-Za-z0-9._-]{1,80}\.(png|jpg)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_PUT(self):
        if not self.path.startswith("/_shot/"):
            self.send_error(404, "only /_shot/<name>.png accepts a PUT")
            return
        name = os.path.basename(self.path[len("/_shot/"):])
        if not SAFE.match(name):
            self.send_error(400, "name must be a bare <something>.png or .jpg")
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 64 * 1024 * 1024:
            self.send_error(413, "empty or too large")
            return
        raw = self.rfile.read(n).decode("ascii", "replace")
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            blob = base64.b64decode(raw, validate=False)
        except Exception as e:                      # a malformed body is a bug to see, not to hide
            self.send_error(400, f"bad base64: {e}")
            return
        SHOTS.mkdir(exist_ok=True)
        out = SHOTS / name
        out.write_bytes(blob)
        body = f"{out}\n{len(blob)} bytes\n".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        sys.stderr.write(f"saved {out} ({len(blob)} bytes)\n")

    def end_headers(self):
        # the whole point of this server is iteration; a cached page is a wrong measurement
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "_shot" in (args[0] if args else ""):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
    with Server(("127.0.0.1", port), Handler) as httpd:
        print(f"anchor-demo on http://127.0.0.1:{port}/   shots -> {SHOTS}")
        httpd.serve_forever()
