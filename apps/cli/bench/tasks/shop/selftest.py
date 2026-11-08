#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request
from urllib.parse import urlencode

BASE = "http://127.0.0.1:8821"
SECRETS = ["DK-2814", "DESKDAYS", "expedited", "548", "94104"]
OFFICE = {"ship_to": "new", "name": "Jordan Lee", "company": "Northwind Labs", "line1": "548 Market St", "line2": "Suite 1200",
          "city": "San Francisco", "state": "CA", "zip": "94104", "phone": "(415) 555-0198", "shipping": "expedited", "payment": "card-4417"}


def call(method, path, form=None):
    data = urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode(), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), path


def check():
    return json.loads(call("GET", "/api/check")[1])


def order(sku="DK-2814", qty=3, codes=("DESKDAYS",), address=None):
    call("GET", "/c/docks-hubs?sort=featured&page=2")
    call("POST", "/cart/add", {"sku": sku, "qty": str(qty)})
    for code in codes:
        call("POST", "/cart/coupon", {"code": code})
    call("GET", "/checkout")
    return call("POST", "/checkout", address or OFFICE)


failures = 0


def report(name, ok, extra=""):
    global failures
    failures += not ok
    print(f"{'PASS' if ok else 'FAIL'} {name}{' ' + extra if extra else ''}")


call("POST", "/api/reset")
c = check()
report("initial check fails and leaks nothing", not c["pass"] and c["completed_at_ms"] is None and not any(s in json.dumps(c) for s in SECRETS))

call("POST", "/api/reset")
page1 = call("GET", "/c/docks-hubs")[1]
page2 = call("GET", "/c/docks-hubs?sort=featured&page=2")[1]
report("answer is on page 2, not page 1", "DK-2814" not in page1 and "harbor-h12" in page2)
call("POST", "/cart/add", {"sku": "DK-2814", "qty": "3"})
expired = call("POST", "/cart/coupon", {"code": "TECH20"})[1]
other = call("POST", "/cart/coupon", {"code": "SCREENS25"})[1]
report("expired and wrong-category codes are refused", "expired on" in expired and "apply to the items" in other)
status, body, _ = call("POST", "/checkout", dict(OFFICE, zip="9410", phone="+1 415 555 0198", line1=""))
report("checkout shows inline errors", status == 422 and body.count('class="err"') == 3 and "error-summary" in body)

for name in ("correct", "correct again after reset"):
    call("POST", "/api/reset")
    status, body, url = order()
    c = check()
    report(name, status == 200 and "/orders/" in url and c["pass"] and c["completed_at_ms"] and c["matched"] == c["total"], json.dumps(c["details"]["wrong"]))

traps = {
    "decoy 4K at 30 Hz": dict(sku="DK-3317"),
    "decoy 85 W to laptop": dict(sku="DK-3542"),
    "page-1 pricier qualifier": dict(sku="DK-4016"),
    "decoy coupon FALL10": dict(codes=("DESKDAYS", "FALL10")),
    "expired coupon only": dict(codes=("TECH20",)),
    "saved home address": dict(address=dict(OFFICE, ship_to="saved")),
    "cheapest shipping misses date": dict(address=dict(OFFICE, shipping="standard")),
    "wrong quantity": dict(qty=1),
}
for name, kwargs in traps.items():
    call("POST", "/api/reset")
    status, _, url = order(**kwargs)
    c = check()
    report(f"trap {name}", not c["pass"] and c["completed_at_ms"] is None, f"ordered={'/orders/' in url} wrong={c['details']['wrong']}")

call("POST", "/api/reset")
c = check()
cart = call("GET", "/cart")[1]
report("reset clears orders and cart", c["details"]["orders_placed"] == 0 and "Your cart is empty" in cart)
sys.exit(1 if failures else 0)
