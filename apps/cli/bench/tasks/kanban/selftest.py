#!/usr/bin/env python3
import hashlib
import json
import re
import secrets
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8841"
MOVE_EVENT = "drop:1:50"
CLICK_EVENT = "click:1:50"
failures = []


def sha256_hex(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def http(method, path, data=None, headers=None):
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


class Session:
    def __init__(self):
        status, page, headers = http("GET", "/")
        assert status == 200, status
        self.cookie = headers["Set-Cookie"].split(";")[0]
        html = page.decode()
        self.csrf = re.search(r'<meta name="csrf-token" content="([0-9a-f]+)">', html).group(1)
        self.key = re.search(r'<meta name="app-build" content="([0-9a-f]+)">', html).group(1)[::-1]
        self.event = CLICK_EVENT

    def headers(self, method, path, data, event, nonce=None):
        nonce = nonce or secrets.token_hex(8)
        sig = sha256_hex(f"{self.key}|{self.csrf}|{nonce}|{method}|{path}|{sha256_hex(data)}|{event}")[:32]
        return {"Cookie": self.cookie, "Content-Type": "application/json", "X-CSRF-Token": self.csrf,
                "X-Req-Nonce": nonce, "X-Req-Sig": sig, "X-UI-Evt": event}

    def call(self, method, path, body=None, event=None):
        data = json.dumps(body).encode() if body is not None else b""
        headers = self.headers(method, path, data, event or self.event) if method != "GET" else {"Cookie": self.cookie}
        status, raw, _ = http(method, path, data if method != "GET" else None, headers)
        return status, json.loads(raw)


S = Session()


def call(method, path, body=None, event=None):
    return S.call(method, path, body, event)


def raw_call(method, path, body=None, headers=None):
    status, raw, _ = http(method, path, json.dumps(body).encode() if body is not None else None,
                          {"Content-Type": "application/json", **(headers or {})})
    return status, json.loads(raw)


def check():
    return http("GET", "/api/check")[1]


def reset():
    http("POST", "/api/reset")


def board():
    return call("GET", "/api/board")[1]


def column_length(key):
    return len(next(c for c in board()["columns"] if c["key"] == key)["cards"])


def move(ref, column, index=None):
    call("POST", f"/api/cards/{ref}/move", {"column": column, "index": column_length(column) if index is None else index},
         MOVE_EVENT if S.event == CLICK_EVENT else None)


def labels(ref):
    return next(c for c in board()["cards"] if c["id"] == ref)["labels"]


def toggle_label(ref, label):
    current = labels(ref)
    call("PATCH", f"/api/cards/{ref}", {"labels": [l for l in current if l != label] if label in current else current + [label]})


def archive(ref, intent_for=None, intent=None):
    if intent is None and intent_for is not False:
        intent = call("POST", f"/api/cards/{intent_for or ref}/archive-intent")[1]["intent"]
    call("PATCH", f"/api/cards/{ref}", {"archived": True, **({"intent": intent} if intent else {})})
    return intent


def solve(move_top="SYNC-366", push="SYNC-393", backlog="SYNC-446", labelled="SYNC-371", add_label="Needs QA",
          due="2026-11-12", archive_ref="SYNC-404", delete_instead=False, skip_top=False, intent_for=None):
    move(move_top, "review", None if skip_top else 0)
    move(push, "done", 0)
    move(backlog, "todo")
    toggle_label(labelled, add_label)
    toggle_label(labelled, "Blocked")
    call("PATCH", f"/api/cards/{labelled}", {"due": due})
    if delete_instead:
        return call("DELETE", f"/api/cards/{archive_ref}")
    return archive(archive_ref, intent_for)


def report(name, ok, extra=""):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{': ' + extra if extra else ''}")
    if not ok:
        failures.append(name)


def case(name, expect_pass, steps, event=CLICK_EVENT, failed_invariant=None, label=None):
    reset()
    S.event = event
    steps()
    S.event = CLICK_EVENT
    result = json.loads(check())
    ok = result["pass"] == expect_pass and (result["completed_at_ms"] is not None) == expect_pass
    if failed_invariant:
        ok = ok and result["invariants"][failed_invariant] is False and failed_invariant in result["details"]["failed_invariants"]
    if label:
        ok = ok and result["method"]["label"] == label
    report(name, ok, f"pass={result['pass']} matched={result['matched']}/{result['total']} "
                     f"failed={','.join(result['details']['failed_invariants']) or '-'} method={result['method']['label']}")
    return result


fresh = case("fresh state fails", False, lambda: None, label="none")
report("fresh state holds every invariant", all(fresh["invariants"].values()) and set(fresh) >= {
    "pass", "matched", "total", "completed_at_ms", "reset_at_ms", "details", "invariants", "method"})
leak = json.dumps(fresh)
leaked = [v for v in ("Needs QA", "2026-11-12", '"archived": true', "expected", "intent\":") if v in leak]
report("check leaks no answers", not leaked, ", ".join(leaked))

case("correct solution passes", True, solve, label="ui")
case("trap: moved the iOS push card instead of Android", False, lambda: solve(push="SYNC-392"))
case("trap: labels edited on the file-names search card", False, lambda: solve(labelled="SYNC-402"))
case("trap: added QA automation instead of Needs QA", False, lambda: solve(add_label="QA automation"))
case("trap: deleted instead of archived", False, lambda: solve(delete_instead=True))
case("trap: archived the FTS5 spike instead of WAL", False, lambda: solve(archive_ref="SYNC-412"))
case("trap: offline queue left at the bottom of In review", False, lambda: solve(skip_top=True))
case("trap: extra change to another card", False, lambda: (solve(), call("PATCH", "/api/cards/SYNC-402", {"due": "2026-11-12"})))

reset()
before = board()
attempts = {
    "unsigned": raw_call("PATCH", "/api/cards/SYNC-404", {"archived": True}),
    "no session": raw_call("PATCH", "/api/cards/SYNC-404", {"archived": True},
                           {k: v for k, v in S.headers("PATCH", "/api/cards/SYNC-404", b'{"archived": true}', CLICK_EVENT).items() if k != "Cookie"}),
    "wrong csrf": raw_call("PATCH", "/api/cards/SYNC-404", {"archived": True},
                           {**S.headers("PATCH", "/api/cards/SYNC-404", b'{"archived": true}', CLICK_EVENT), "X-CSRF-Token": "0" * 32}),
    "tampered body": raw_call("PATCH", "/api/cards/SYNC-404", {"archived": True},
                              S.headers("PATCH", "/api/cards/SYNC-404", b'{"archived": false}', CLICK_EVENT)),
    "forged event": raw_call("PATCH", "/api/cards/SYNC-404", {"archived": True},
                             {**S.headers("PATCH", "/api/cards/SYNC-404", b'{"archived": true}', "none"), "X-UI-Evt": CLICK_EVENT}),
    "unsigned move": raw_call("POST", "/api/cards/SYNC-366/move", {"column": "review", "index": 0}),
    "unsigned delete": raw_call("DELETE", "/api/cards/SYNC-404"),
    "unsigned intent": raw_call("POST", "/api/cards/SYNC-404/archive-intent"),
}
replay_headers = S.headers("POST", "/api/cards/SYNC-366/move", b'{"column": "review", "index": 0}', MOVE_EVENT)
first = raw_call("POST", "/api/cards/SYNC-366/move", {"column": "review", "index": 0}, replay_headers)
call("POST", "/api/cards/SYNC-366/move", {"column": "progress", "index": 0}, MOVE_EVENT)
attempts["replayed nonce"] = raw_call("POST", "/api/cards/SYNC-366/move", {"column": "review", "index": 0}, replay_headers)
for name, (status, body) in attempts.items():
    report(f"direct write rejected: {name}", status == 403 and body.get("error") == "forbidden", str(status))
after = board()
result = json.loads(check())
report("rejected writes change nothing", first[0] == 200 and after == before and result["method"]["rejected"] == len(attempts),
       f"rejected={result['method']['rejected']} reasons={result['method']['rejected_reasons']}")

case("signed write with no event is accepted as no_event", True, solve, event="none", label="no_event")
case("signed write after an untrusted event is ui_scripted", True, solve, event="click:0:40", label="ui_scripted")
case("signed write long after the last event is no_event", True, solve, event="click:1:9000", label="no_event")

case("invariant: archived without the confirmation dialog", False, lambda: solve(intent_for=False), failed_invariant="archive_confirmed")
case("invariant: archived with another card's confirmation", False, lambda: solve(intent_for="SYNC-412"), failed_invariant="archive_confirmed")
case("invariant: one confirmation reused for a second archive", False,
     lambda: archive("SYNC-404", intent=(solve(), call("PATCH", "/api/cards/SYNC-404", {"archived": False}))[0]),
     failed_invariant="archive_confirmed")
case("invariant: due date sent as a timestamp, not the picker's date", False,
     lambda: solve(due="2026-11-12T00:00:00Z"), failed_invariant="due_from_picker")
case("invariant: due date outside the picker's range, then corrected", False,
     lambda: (call("PATCH", "/api/cards/SYNC-371", {"due": "2031-11-12"}), solve()), failed_invariant="due_from_picker")
case("invariant: a label the picker doesn't offer, then removed", False,
     lambda: (toggle_label("SYNC-371", "Needs-QA"), toggle_label("SYNC-371", "Needs-QA"), solve()), failed_invariant="labels_from_set")
reset()
solve(due="2026-11-12T00:00:00Z")
stored = next(c for c in board()["cards"] if c["id"] == "SYNC-371")["due"]
report("server stays permissive: a timestamp due date is stored as the date", stored == "2026-11-12", stored)
case("reset restores state, correct run passes again", True, solve, label="ui")
reset()
sys.exit(1 if failures else 0)
