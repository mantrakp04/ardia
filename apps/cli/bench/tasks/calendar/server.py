#!/usr/bin/env python3
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever

PORT = 8791
HERE = Path(__file__).resolve().parent
EXPECTED = [
    {"title": "Pipeline review", "calendar": "board", "date": "2026-11-09", "start": "10:00", "end": "11:00"},
    {"title": "Design partner call", "calendar": "board", "date": "2026-11-10", "start": "14:00", "end": "15:00"},
    {"title": "Board prep", "calendar": "board", "date": "2026-11-11", "start": "09:00", "end": "10:30"},
    {"title": "Q3 deck review", "calendar": "board", "date": "2026-11-12", "start": "16:00", "end": "17:00"},
    {"title": "Investor update", "calendar": "board", "date": "2026-11-13", "start": "11:00", "end": "12:00"},
]
FIELDS = ("title", "calendar", "date", "start", "end")
LOCK = threading.Lock()
STATE = {"events": [], "reset_at_ms": now_ms()}


def normalize(e):
    return {k: str(e.get(k, "")).strip() for k in FIELDS}


def key(e):
    return (e["title"].lower(), e["calendar"], e["date"], e["start"], e["end"])


def check():
    with LOCK:
        got = [dict(e) for e in STATE["events"]]
        reset_at = STATE["reset_at_ms"]
    want = {key(e) for e in EXPECTED}
    have = [key(e) for e in got]
    matched = sorted(want & set(have))
    passed = len(matched) == len(EXPECTED) and len(have) == len(EXPECTED)
    return {
        "pass": passed,
        "matched": len(matched),
        "extra": len([k for k in have if k not in want]),
        "completed_at_ms": max(e["saved_at_ms"] for e in got) if passed else None,
        "reset_at_ms": reset_at,
        "details": {"total_events": len(have), "missing": len(want - set(have)),
                    "extra": [k for k in have if k not in want], "events": got},
    }


class CalendarHandler(Handler):
    def do_GET(self):
        if self.path_only == "/api/events":
            with LOCK:
                return self.send(200, list(STATE["events"]))
        if self.path_only == "/api/check":
            return self.send(200, check())
        return self.static()

    def do_POST(self):
        if self.path_only == "/api/reset":
            with LOCK:
                STATE["events"] = []
                STATE["reset_at_ms"] = now_ms()
            return self.send(200, {"ok": True})
        if self.path_only == "/api/events":
            body = self.body_json()
            if not isinstance(body, dict):
                return self.send(400, {"error": "bad json"})
            e = normalize(body)
            if not e["title"] or not e["date"] or not e["start"] or not e["end"]:
                return self.send(400, {"error": "missing field"})
            e["saved_at_ms"] = now_ms()
            with LOCK:
                STATE["events"].append(e)
            return self.send(200, e)
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    serve_forever([(PORT, CalendarHandler, HERE / "fixture")], f"calendar http://127.0.0.1:{PORT}/")
