#!/usr/bin/env python3
import hashlib
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request

OFFSET = int(os.environ.get("BENCH_PORT_OFFSET") or 0)
MAIL = f"http://127.0.0.1:{8792 + OFFSET}"
EXPENSES = f"http://127.0.0.1:{8793 + OFFSET}"
CORRECT = [
    ("Delta Air Lines", "2026-10-03", "Travel", 41260),
    ("Blue Bottle Coffee", "2026-10-07", "Meals", 1840),
    ("Figma", "2026-10-09", "Software", 4860),
    ("Staples", "2026-10-14", "Office", 6327),
    ("Marriott", "2026-10-21", "Travel", 28900),
]
SECRETS = ["Blue Bottle", "Figma", "Staples", "2026-10-07", "2026-10-09", "2026-10-14", "1840", "4860", "6327",
           "28900", "18.40", "48.60", "63.27", "289.00", "Meals", "Software", "Office"]
TIMING = ("completed_at_ms", "reset_at_ms", "submitted_at_ms", "submitted_ms_after_reset")
UI = "click:1:50"


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def raw(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


class Session:
    def __init__(self, base):
        self.base = base
        _, headers, page = raw("GET", base + "/")
        html = page.decode()
        self.cookie = headers["Set-Cookie"].split(";")[0]
        self.csrf = re.search(r'<meta name="csrf-token" content="([^"]+)">', html).group(1)
        self.key = re.search(r'<meta name="app-build" content="([^"]+)">', html).group(1)[::-1]

    def call(self, method, path, body=None, event=UI, signed=True, cookie=True, sig=None, nonce=None):
        data = json.dumps(body).encode() if body is not None else b""
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if cookie:
            headers["Cookie"] = self.cookie
        if signed and method != "GET":
            nonce = nonce or secrets.token_hex(8)
            headers.update({
                "X-CSRF-Token": self.csrf, "X-Req-Nonce": nonce, "X-UI-Evt": event,
                "X-Req-Sig": sig or sha(f"{self.key}|{self.csrf}|{nonce}|{method}|{path}|{sha(data)}|{event}")[:32],
            })
        status, _, out = raw(method, self.base + path, data if method != "GET" else None, headers)
        try:
            return status, json.loads(out or b"null")
        except ValueError:
            return status, None


def reset():
    raw("POST", EXPENSES + "/api/reset", b"")


def check():
    return json.loads(raw("GET", EXPENSES + "/api/check")[2])


def report_lines(s):
    return s.call("GET", "/api/report")[1]["lines"]


def build_draft(s, target, event=UI):
    existing = {l["merchant"]: l for l in report_lines(s)}
    ids = []
    for merchant, date, category, cents in target:
        payload = {"merchant": merchant, "date": date, "category": category, "amount_cents": cents}
        old = existing.pop(merchant, None)
        if old:
            if any(old[k] != v for k, v in payload.items()):
                s.call("PUT", f"/api/lines/{old['id']}", payload, event)
            ids.append(old["id"])
        else:
            ids.append(s.call("POST", "/api/lines", payload, event)[1]["id"])
    for line in existing.values():
        s.call("DELETE", f"/api/lines/{line['id']}", None, event)
    if [l["id"] for l in report_lines(s)] != ids:
        s.call("POST", "/api/lines/order", {"ids": ids}, event)


def wire(lines):
    return [dict(l, amount="%d.%02d" % divmod(l["amount_cents"], 100)) for l in lines]


def submit(s, event=UI, lines=None, intent=True):
    token = s.call("POST", "/api/submit/intent", {"report": "rpt_2026_10"}, event)[1]["intent"] if intent is True else intent
    body = {"report": "rpt_2026_10", "lines": wire(report_lines(s) if lines is None else lines)}
    if token is not None:
        body["intent"] = token
    return s.call("POST", "/api/submit", body, event)


def solve(target, event=UI):
    reset()
    s = Session(EXPENSES)
    build_draft(s, target, event)
    status, _ = submit(s, event)
    return status, check()


def leaks(c):
    visible = json.dumps({k: v for k, v in c.items() if k not in TIMING and k != "details"} |
                         {"details": {k: v for k, v in c["details"].items() if k not in TIMING and k != "submitted_lines"}})
    mine = json.dumps(c["details"]["submitted_lines"])
    return [x for x in SECRETS if x in visible and x not in mine]


def replace(target, merchant, **changes):
    fields = ("merchant", "date", "category", "cents")
    return [tuple({**dict(zip(fields, t)), **changes}[f] for f in fields) if t[0] == merchant else t for t in target]


failures = 0


def report(name, ok, extra=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{' ' + extra if extra else ''}")


reset()
c = check()
report("fresh state fails and leaks nothing", c["pass"] is False and c["completed_at_ms"] is None and not leaks(c)
       and not any(c["invariants"].values()) and c["method"]["label"] == "none", json.dumps(leaks(c)))

for name in ("correct through signed UI-shaped requests", "correct again after reset"):
    status, c = solve(CORRECT)
    report(name, status == 200 and c["pass"] and c["completed_at_ms"] and c["matched"] == c["total"]
           and all(c["invariants"].values()) and c["method"]["label"] == "ui" and c["method"]["apps"]["expenses"]["ui"] > 0,
           json.dumps(c["details"]["mismatches"]))

traps = {
    "Marriott draft amount left at 298.00": replace(CORRECT, "Marriott", cents=29800),
    "Marriott at the pre-stay room rate": replace(CORRECT, "Marriott", cents=24900),
    "Marriott on the check-in date": replace(CORRECT, "Marriott", date="2026-10-20"),
    "Figma left in euros": replace(CORRECT, "Figma", cents=4500),
    "Figma at September's rate": replace(CORRECT, "Figma", cents=4995),
    "Delta on the flight date": replace(CORRECT, "Delta Air Lines", date="2026-10-19"),
    "Delta fare without taxes": replace(CORRECT, "Delta Air Lines", cents=35628),
    "Blue Bottle subtotal": replace(CORRECT, "Blue Bottle Coffee", cents=1675),
    "Blue Bottle filed as Other": replace(CORRECT, "Blue Bottle Coffee", category="Other"),
    "Staples subtotal": replace(CORRECT, "Staples", cents=5747),
    "refunded Uber trip included": CORRECT + [("Uber", "2026-10-24", "Travel", 3175)],
    "September GitHub bill included": [("GitHub", "2026-09-30", "Software", 2100)] + CORRECT,
    "Staples missing": [t for t in CORRECT if t[0] != "Staples"],
    "lines not in date order": CORRECT[-1:] + CORRECT[:-1],
}
for name, target in traps.items():
    status, c = solve(target)
    report(f"trap fails: {name}", status == 200 and not c["pass"] and c["completed_at_ms"] is None and not leaks(c)
           and all(c["invariants"].values()), json.dumps(leaks(c)))

reset()
s = Session(EXPENSES)
before = report_lines(s)
payload = {"merchant": "Figma", "date": "2026-10-09", "category": "Software", "amount_cents": 4860}
attempts = {
    "unsigned": s.call("POST", "/api/lines", payload, signed=False),
    "no session cookie": s.call("POST", "/api/lines", payload, cookie=False),
    "bad signature": s.call("POST", "/api/lines", payload, sig="0" * 32),
    "unsigned submit": s.call("POST", "/api/submit", {"report": "rpt_2026_10", "lines": wire(before)}, signed=False),
    "unsigned delete": s.call("DELETE", f"/api/lines/{before[0]['id']}", signed=False),
}
c = check()
report("unsigned or forged writes get 403 and change nothing",
       all(st == 403 for st, _ in attempts.values()) and report_lines(s) == before and c["details"]["submissions"] == 0
       and c["method"]["apps"]["expenses"]["rejected"] == len(attempts) and c["method"]["accepted"] == 0,
       json.dumps({k: v[0] for k, v in attempts.items()}))
nonce = secrets.token_hex(8)
first = s.call("POST", "/api/lines", payload, nonce=nonce)[0]
replayed = s.call("POST", "/api/lines", payload, nonce=nonce)[0]
report("replayed nonce gets 403", first == 201 and replayed == 403 and len(report_lines(s)) == len(before) + 1)

reset()
mail = Session(MAIL)
mid = json.loads(raw("GET", MAIL + "/api/messages?limit=1")[2])["messages"][0]["id"]
unsigned = mail.call("POST", f"/api/messages/{mid}/read", signed=False)[0]
expenses_session = Session(EXPENSES)
cross = raw("POST", f"{MAIL}/api/messages/{mid}/read", b"", {"Cookie": expenses_session.cookie, "X-CSRF-Token": expenses_session.csrf})[0]
signed = mail.call("POST", f"/api/messages/{mid}/read")[0]
m = check()["method"]["apps"]["mail"]
report("mail read needs the mail session's signature", unsigned == 403 and cross == 403 and signed == 200 and m["ui"] == 1
       and m["rejected"] == 2, f"{unsigned} {cross} {signed} {m}")

status, c = solve(CORRECT, event="none")
report("signed writes with no event pass and are labelled no_event",
       status == 200 and c["pass"] and c["method"]["label"] == "no_event" and c["method"]["apps"]["expenses"]["ui"] == 0)
status, c = solve(CORRECT, event="click:0:40")
report("signed writes from a scripted click are labelled ui_scripted", c["pass"] and c["method"]["label"] == "ui_scripted")
status, c = solve(CORRECT, event="click:1:9000")
report("a trusted event older than 2 s is labelled no_event", c["pass"] and c["method"]["label"] == "no_event")


def violation(name, invariant, run):
    reset()
    s = Session(EXPENSES)
    run(s)
    c = check()
    others = [k for k, v in c["invariants"].items() if k != invariant and not v]
    report(f"invariant fails: {name}", not c["pass"] and c["completed_at_ms"] is None and c["invariants"][invariant] is False
           and not others and invariant in c["details"]["failed_invariants"] and not leaks(c),
           json.dumps({"invariants": c["invariants"], "mismatches": c["details"]["mismatches"]}))


def submit_without_draft(s):
    submit(s, lines=[{"id": None, "merchant": m, "date": d, "category": k, "amount_cents": a} for m, d, k, a in CORRECT])


def submit_unsaved_edit(s):
    build_draft(s, replace(CORRECT, "Marriott", cents=29800))
    lines = report_lines(s)
    submit(s, lines=[dict(l, amount_cents=28900) if l["merchant"] == "Marriott" else l for l in lines])


def submit_stale_intent(s):
    build_draft(s, CORRECT)
    token = s.call("POST", "/api/submit/intent", {"report": "rpt_2026_10"})[1]["intent"]
    s.call("POST", "/api/lines/order", {"ids": [l["id"] for l in report_lines(s)]})
    submit(s, intent=token)


def submit_after_add_delete(s):
    build_draft(s, CORRECT)
    token = s.call("POST", "/api/submit/intent", {"report": "rpt_2026_10"})[1]["intent"]
    extra = s.call("POST", "/api/lines", {"merchant": "Uber", "date": "2026-10-24", "category": "Travel", "amount_cents": 3175})[1]
    s.call("DELETE", f"/api/lines/{extra['id']}")
    submit(s, intent=token)


violation("submitted straight to /api/submit, draft never built", "submitted_matches_draft", submit_without_draft)
violation("submitted lines differ from the saved draft", "submitted_matches_draft", submit_unsaved_edit)
violation("submitted without a confirmation intent", "submitted_via_confirmation",
          lambda s: (build_draft(s, CORRECT), submit(s, intent=None)))
violation("submitted with a made-up intent", "submitted_via_confirmation",
          lambda s: (build_draft(s, CORRECT), submit(s, intent="x" * 24)))
violation("intent issued before the last reorder", "submitted_via_confirmation", submit_stale_intent)
violation("intent issued before a line was added and deleted", "submitted_via_confirmation", submit_after_add_delete)

reset()
print(f"\n{'all passed' if not failures else f'{failures} failed'}")
sys.exit(1 if failures else 0)
