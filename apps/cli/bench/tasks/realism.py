import hashlib
import secrets
import threading
from http.cookies import SimpleCookie

from benchhttp import now_ms

UI_EVENT_MAX_AGE_MS = 2000


def sha256_hex(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def signature(key, csrf, nonce, method, path, body, event):
    return sha256_hex(f"{key}|{csrf}|{nonce}|{method}|{path}|{sha256_hex(body)}|{event}")[:32]


def parse_event(raw):
    if not raw or raw == "none":
        return None
    parts = raw.split(":")
    if len(parts) != 3:
        return {"type": "malformed", "trusted": False, "age_ms": None}
    kind, trusted, age = parts
    try:
        age_ms = int(age)
    except ValueError:
        age_ms = None
    if age_ms is not None and age_ms < 0:
        return {"type": "malformed", "trusted": False, "age_ms": None}
    return {"type": kind, "trusted": trusted == "1", "age_ms": age_ms}


def classify(event):
    if event is None or event.get("age_ms") is None or event["age_ms"] > UI_EVENT_MAX_AGE_MS:
        return "no_event"
    return "ui" if event["trusted"] else "ui_scripted"


class Guard:
    def __init__(self, app):
        self.app = app
        self.cookie = f"sid_{app}"
        self.lock = threading.Lock()
        self.sessions = {}
        self.writes = []
        self.nonces = set()

    def reset(self):
        with self.lock:
            self.writes = []
            self.nonces = set()

    def session_for(self, handler, create=False):
        jar = SimpleCookie()
        try:
            jar.load(handler.headers.get("Cookie") or "")
        except Exception:
            pass
        sid = jar[self.cookie].value if self.cookie in jar else None
        with self.lock:
            if sid in self.sessions:
                return sid, self.sessions[sid], None
            if not create:
                return None, None, None
            sid = secrets.token_hex(16)
            self.sessions[sid] = {"csrf": secrets.token_hex(16), "key": secrets.token_hex(12)}
            return sid, self.sessions[sid], f"{self.cookie}={sid}; Path=/; HttpOnly; SameSite=Lax"

    def render_page(self, handler, html):
        _, sess, set_cookie = self.session_for(handler, create=True)
        key_attr = sess["key"][::-1]
        meta = (f'<meta name="csrf-token" content="{sess["csrf"]}">'
                f'<meta name="app-build" content="{key_attr}">')
        page = html.replace("</head>", f"{meta}</head>", 1) if "</head>" in html else meta + html
        headers = {"Set-Cookie": set_cookie} if set_cookie else {}
        handler.send(200, page.encode(), "text/html; charset=utf-8", headers=headers)

    def verify_write(self, handler, body):
        method = handler.command
        path = handler.path_only
        event_raw = handler.headers.get("X-UI-Evt") or "none"
        event = parse_event(event_raw)
        record = {"t": now_ms(), "method": method, "path": path, "event": event, "kind": None, "reason": None}
        _, sess, _ = self.session_for(handler)
        csrf = handler.headers.get("X-CSRF-Token")
        nonce = handler.headers.get("X-Req-Nonce") or ""
        sig = handler.headers.get("X-Req-Sig") or ""
        with self.lock:
            if sess is None:
                record["reason"] = "no_session"
            elif csrf != sess["csrf"]:
                record["reason"] = "csrf"
            elif not nonce or nonce in self.nonces:
                record["reason"] = "nonce"
            elif sig != signature(sess["key"], csrf, nonce, method, path, body, event_raw):
                record["reason"] = "signature"
            if record["reason"]:
                record["kind"] = "rejected"
            else:
                record["kind"] = classify(event)
                self.nonces.add(nonce)
            self.writes.append(record)
        return record

    def reject(self, handler, record):
        handler.send(403, {"error": "forbidden", "reason": "request could not be verified"})

    def summary(self):
        with self.lock:
            writes = list(self.writes)
        counts = {"ui": 0, "ui_scripted": 0, "no_event": 0, "rejected": 0}
        reasons = {}
        events = {}
        for w in writes:
            counts[w["kind"]] += 1
            if w["reason"]:
                reasons[w["reason"]] = reasons.get(w["reason"], 0) + 1
            if w["kind"] != "rejected" and w["event"]:
                key = f"{w['event']['type']}:{'trusted' if w['event']['trusted'] else 'scripted'}"
                events[key] = events.get(key, 0) + 1
        accepted = counts["ui"] + counts["ui_scripted"] + counts["no_event"]
        label = "none"
        if accepted:
            label = "ui" if counts["ui"] == accepted else ("no_event" if counts["no_event"] == accepted else
                                                         ("ui_scripted" if counts["ui_scripted"] == accepted else "mixed"))
        return {"label": label, "accepted": accepted, **counts, "rejected_reasons": reasons, "trigger_events": events}
