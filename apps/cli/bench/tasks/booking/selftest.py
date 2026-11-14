#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8811"
SECRETS = ["AQ1207", "1991-03-14", "1990-07-02", "4155550198", "Avery", "Okafor", "24E", "27A"]


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def booking(flight="AQ1207-20261203", fare="M", seats=("24E", "24F"), exit_ack=False, phone="(415) 555-0198", middle="Avery"):
    return {"flight": flight, "cabin": "economy", "fare": fare,
            "passengers": [{"first": "Jordan", "middle": middle, "no_middle": False, "last": "Lee", "dob": "1991-03-14", "known_traveler": ""},
                           {"first": "Sam", "middle": "", "no_middle": True, "last": "Okafor", "dob": "1990-07-02", "known_traveler": ""}],
            "contact": {"email": "jordan@northwind.dev", "country": "+1", "phone": phone},
            "seats": list(seats), "exit_ack": exit_ack, "fare_rules": True}


def run(payload):
    call("GET", "/api/airports")
    call("GET", "/api/availability?origin=SFO&destination=SEA&date=2026-12-03&adults=2&children=0&cabin=economy")
    call("GET", f"/api/seatmap?flight={payload['flight']}")
    status, body = call("POST", "/api/passengers/validate", payload)
    if status != 200:
        return status, body
    return call("POST", "/api/bookings", payload)


failures = 0


def report(name, ok, extra=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{' ' + extra if extra else ''}")


call("POST", "/api/reset")
_, c = call("GET", "/api/check")
report("initial check fails and leaks nothing", c["pass"] is False and c["completed_at_ms"] is None and not any(s in json.dumps(c) for s in SECRETS))

call("POST", "/api/reset")
status, body = call("POST", "/api/bookings", dict(booking(), fare_rules=False))
report("server rejects unticked fare rules", status == 422 and any(e["field"] == "fare_rules" for e in body["errors"]))
status, body = call("POST", "/api/passengers/validate", booking(phone="+1 415 555 0198", middle="", seats=("24E", "")))
fields = {e["field"] for e in body.get("errors", [])}
report("server rejects phone, middle name, missing seat", status == 422 and {"contact.phone", "passengers.0.middle", "seats.1"} <= fields)

for name in ("correct", "correct again after reset"):
    call("POST", "/api/reset")
    status, _ = run(booking())
    _, c = call("GET", "/api/check")
    report(name, status == 200 and c["pass"] and c["completed_at_ms"] and c["matched"] == c["total"], json.dumps(c["details"]["wrong"]))

traps = {
    "basic fare, no seats": booking(fare="B", seats=("", "")),
    "earlier 1-stop 9:05": booking(flight="AQ2211-20261203", seats=("24E", "24F")),
    "nonstop at 8:55": booking(flight="AQ1205-20261203", seats=("24E", "24F")),
    "exit-row window pair": booking(seats=("14A", "14B"), exit_ack=True),
    "pair across the aisle": booking(seats=("16C", "16D")),
    "preferred window pair": booking(seats=("7A", "7B")),
}
for name, payload in traps.items():
    call("POST", "/api/reset")
    status, body = run(payload)
    if payload["flight"] != "AQ1207-20261203" and status == 422:
        seat_free = call("GET", f"/api/seatmap?flight={payload['flight']}")[1]
        free = [(r["row"], s["letter"]) for r in seat_free["rows"] if r["kind"] == "standard" for s in r["seats"] if s["available"]]
        pairs = [f"{r}{a}" for r, a in free if a in "AE" and (r, chr(ord(a) + 1)) in free]
        if pairs:
            first = pairs[0]
            payload["seats"] = [first, first[:-1] + chr(ord(first[-1]) + 1)]
            status, body = run(payload)
    _, c = call("GET", "/api/check")
    report(f"trap {name}", c["pass"] is False and c["completed_at_ms"] is None, f"booked={status == 200} wrong={c['details']['wrong']}")

call("POST", "/api/reset")
_, c = call("GET", "/api/check")
report("reset clears bookings", c["details"]["bookings_confirmed"] == 0 and c["pass"] is False)
sys.exit(1 if failures else 0)
