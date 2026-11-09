#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8841"
failures = []


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def board():
    return call("GET", "/api/board")[1]


def column_length(key):
    return len(next(c for c in board()["columns"] if c["key"] == key)["cards"])


def move(ref, column, index=None):
    call("POST", f"/api/cards/{ref}/move", {"column": column, "index": column_length(column) if index is None else index})


def labels(ref):
    return next(c for c in board()["cards"] if c["id"] == ref)["labels"]


def edit_labels(ref, add, remove):
    current = labels(ref)
    call("PATCH", f"/api/cards/{ref}", {"labels": [l for l in current if l != remove] + [add]})


def solve(move_top="SYNC-366", push="SYNC-393", backlog="SYNC-446", labelled="SYNC-371", add_label="Needs QA",
          due="2026-11-12", archive="SYNC-404", delete_instead=False, skip_top=False):
    move(move_top, "review", None if skip_top else 0)
    move(push, "done", 0)
    move(backlog, "todo")
    edit_labels(labelled, add_label, "Blocked")
    call("PATCH", f"/api/cards/{labelled}", {"due": due})
    if delete_instead:
        call("DELETE", f"/api/cards/{archive}")
    else:
        call("PATCH", f"/api/cards/{archive}", {"archived": True})


def case(name, expect_pass, steps):
    call("POST", "/api/reset")
    steps()
    result = call("GET", "/api/check")[1]
    ok = result["pass"] == expect_pass and (result["completed_at_ms"] is not None) == expect_pass
    print(f"{'ok  ' if ok else 'FAIL'} {name}: pass={result['pass']} matched={result['matched']}/{result['total']}")
    if not ok:
        failures.append(name)
    return result


fresh = case("fresh state fails", False, lambda: None)
leak = json.dumps(fresh)
leaked = [v for v in ("Needs QA", "2026-11-12", '"archived": true', 'expected') if v in leak]
print(f"{'ok  ' if not leaked else 'FAIL'} check leaks no answers{': ' + ', '.join(leaked) if leaked else ''}")
if leaked:
    failures.append("leak")
case("correct solution passes", True, solve)
case("trap: moved the iOS push card instead of Android", False, lambda: solve(push="SYNC-392"))
case("trap: labels edited on the file-names search card", False, lambda: solve(labelled="SYNC-402"))
case("trap: added QA automation instead of Needs QA", False, lambda: solve(add_label="QA automation"))
case("trap: deleted instead of archived", False, lambda: solve(delete_instead=True))
case("trap: archived the FTS5 spike instead of WAL", False, lambda: solve(archive="SYNC-412"))
case("trap: offline queue left at the bottom of In review", False, lambda: solve(skip_top=True))
case("trap: extra change to another card", False, lambda: (solve(), call("PATCH", "/api/cards/SYNC-402", {"due": "2026-11-12"})))
case("reset restores state, correct run passes again", True, solve)
call("POST", "/api/reset")
sys.exit(1 if failures else 0)
