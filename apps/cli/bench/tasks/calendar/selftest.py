#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

APP = "http://127.0.0.1:8791"
CORRECT = [
    {"title": "Pipeline review", "calendar": "board", "date": "2026-11-09", "start": "10:00", "end": "11:00"},
    {"title": "Design partner call", "calendar": "board", "date": "2026-11-10", "start": "14:00", "end": "15:00"},
    {"title": "Board prep", "calendar": "board", "date": "2026-11-11", "start": "09:00", "end": "10:30"},
    {"title": "Q3 deck review", "calendar": "board", "date": "2026-11-12", "start": "16:00", "end": "17:00"},
    {"title": "Investor update", "calendar": "board", "date": "2026-11-13", "start": "11:00", "end": "12:00"},
]
ANSWER_STRINGS = ("pipeline", "design partner", "board prep", "q3 deck", "investor", "2026-11-1", "10:30", "16:00")
failures = 0


def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def report(name, ok, extra=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{' ' + extra if extra and not ok else ''}")


def run(name, events, want_pass):
    call("POST", f"{APP}/api/reset")
    statuses = [call("POST", f"{APP}/api/events", event)[0] for event in events]
    _, result = call("GET", f"{APP}/api/check")
    ok = all(s == 200 for s in statuses) and result["pass"] is want_pass and (result["completed_at_ms"] is not None) is want_pass
    report(name, ok, json.dumps(result["details"].get("extra")))


call("POST", f"{APP}/api/reset")
_, initial = call("GET", f"{APP}/api/check")
text = json.dumps({k: v for k, v in initial.items() if not k.endswith("_ms")}).lower()
report("initial check fails and leaks nothing", initial["pass"] is False and initial["matched"] == 0
       and not any(a in text for a in ANSWER_STRINGS), text)

status, _ = call("POST", f"{APP}/api/events", {"title": "", "date": "2026-11-09", "start": "10:00", "end": "11:00"})
report("an event without a title is rejected", status == 400)

run("correct events pass", CORRECT, True)
run("title case doesn't matter", [dict(e, title=e["title"].upper()) for e in CORRECT], True)
run("trap: one event missing", CORRECT[:-1], False)
run("trap: an extra event", CORRECT + [dict(CORRECT[0], title="Coffee")], False)
run("trap: a duplicate event", CORRECT + [CORRECT[0]], False)
run("trap: wrong calendar", [dict(CORRECT[0], calendar="personal")] + CORRECT[1:], False)
run("trap: PM read as AM", CORRECT[:1] + [dict(CORRECT[1], start="02:00", end="03:00")] + CORRECT[2:], False)
run("trap: half-hour end dropped", CORRECT[:2] + [dict(CORRECT[2], end="10:00")] + CORRECT[3:], False)

call("POST", f"{APP}/api/reset")
_, cleared = call("GET", f"{APP}/api/check")
report("reset clears the events", cleared["details"]["total_events"] == 0)
run("second correct run passes again", CORRECT, True)
call("POST", f"{APP}/api/reset")
sys.exit(1 if failures else 0)
