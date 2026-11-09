import json
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
}


def now_ms():
    return int(time.time() * 1000)


class Handler(BaseHTTPRequestHandler):
    server_version = "benchhttp/1"
    root = None

    def log_message(self, fmt, *args):
        if getattr(self.server, "verbose", False):
            sys.stderr.write(f"[{self.server.server_port}] {fmt % args}\n")

    @property
    def path_only(self):
        return urlparse(self.path).path

    @property
    def query(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, bytes):
            data = body
        elif ctype.startswith("application/json"):
            data = json.dumps(body).encode()
        else:
            data = str(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def html(self, code, text):
        self.send(code, text.encode(), STATIC_TYPES[".html"])

    def redirect(self, location):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def body_bytes(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if 0 < n <= 1_000_000 else b""

    def body_json(self):
        try:
            return json.loads(self.body_bytes() or b"null")
        except ValueError:
            return None

    def body_form(self):
        return {k: v[0] for k, v in parse_qs(self.body_bytes().decode("utf-8", "replace"), keep_blank_values=True).items()}

    def static(self, path=None):
        path = self.path_only if path is None else path
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        root = Path(self.root).resolve()
        target = (root / rel).resolve()
        if root not in target.parents or not target.is_file() or target.suffix not in STATIC_TYPES:
            return self.send(404, {"error": "not found"})
        self.send(200, target.read_bytes(), STATIC_TYPES[target.suffix])

    def do_HEAD(self):
        self.do_GET()


def serve_forever(servers, banner, verbose=False):
    started = []
    for port, handler, root in servers:
        cls = type(handler.__name__, (handler,), {"root": root})
        srv = ThreadingHTTPServer((HOST, port), cls)
        srv.daemon_threads = True
        srv.verbose = verbose
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        started.append(srv)
    print(banner, flush=True)
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    while not stop.wait(1):
        pass
    for srv in started:
        srv.shutdown()
