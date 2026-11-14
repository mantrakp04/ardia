#!/usr/bin/env python3
import hashlib
import json
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:8861"
failures = []


def call(method, path, body=None, headers=None):
    data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
            return r.status, dict(r.headers), json.loads(raw) if raw[:1] in (b"{", b"[") else raw.decode()
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, dict(e.headers), json.loads(raw) if raw[:1] in (b"{", b"[") else raw.decode()


def note(ok, text):
    print(f"{'ok  ' if ok else 'FAIL'} {text}")
    if not ok:
        failures.append(text)


def session():
    req = urllib.request.Request(BASE + "/")
    with urllib.request.urlopen(req, timeout=10) as r:
        html = r.read().decode()
        cookie = r.headers.get("Set-Cookie").split(";", 1)[0]
    csrf = re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)
    key = re.search(r'name="app-build" content="([^"]+)"', html).group(1)[::-1]
    return {"cookie": cookie, "csrf": csrf, "key": key}


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def signed(sess, method, path, body, event="click:1:35"):
    raw = json.dumps(body).encode()
    nonce = f"{secrets.randbits(32)}-{secrets.randbits(32)}"
    sig = sha(f"{sess['key']}|{sess['csrf']}|{nonce}|{method}|{urllib.parse.urlparse(path).path}|{sha(raw)}|{event}")[:32]
    return call(method, path, raw, {"Cookie": sess["cookie"], "X-CSRF-Token": sess["csrf"], "X-Req-Nonce": nonce,
                                    "X-Req-Sig": sig, "X-UI-Evt": event})


def token():
    status, _, body = call("GET", "/api/developer/token", headers={"Cookie": session()["cookie"]})
    assert status == 200, body
    return body["token"]


class Api:
    def __init__(self, tok):
        self.auth = {"Authorization": f"Bearer {tok}"}

    def request(self, method, path, body=None):
        for _ in range(20):
            status, headers, data = call(method, path, body, self.auth)
            if status != 429:
                return status, data
            time.sleep(float(headers.get("Retry-After", "1")))
        raise RuntimeError("still rate limited")

    def list_all(self, first_page_only=False, **params):
        params.setdefault("limit", 100)
        out, cursor = [], None
        while True:
            query = dict(params, **({"cursor": cursor} if cursor else {}))
            status, data = self.request("GET", "/v1/orders?" + urllib.parse.urlencode(query))
            assert status == 200, data
            out += data["data"]
            if first_page_only or not data["has_more"]:
                return out
            cursor = data["next_cursor"]

    def batch(self, ops):
        for i in range(0, len(ops), 50):
            status, data = self.request("POST", "/v1/orders/batch", {"operations": ops[i:i + 50]})
            assert status == 200 and all(r["status"] == 200 for r in data["results"]), data


def solve_public(api, archive_max="2026-10-01", archive_channel="legacy_store", replace_tags=False, first_page_only=False, extra_tagged_query=None, tag=True, archive=True):
    legacy = api.list_all(first_page_only=first_page_only, channel="legacy_store")
    archive_filter = {"status": "delivered", "delivered_at_max": archive_max}
    if archive_channel:
        archive_filter["channel"] = archive_channel
    to_archive = {o["id"] for o in api.list_all(**archive_filter)} if archive else set()
    targets = {o["id"]: o for o in legacy}
    if extra_tagged_query:
        targets.update({o["id"]: o for o in api.list_all(q=extra_tagged_query)})
    for oid in to_archive:
        targets.setdefault(oid, None)
    ops = []
    for oid, o in targets.items():
        op = {"id": oid}
        if tag and o is not None:
            op.update({"tags": ["migrated"]} if replace_tags else {"tags_add": ["migrated"]})
        if oid in to_archive:
            op["status"] = "archived"
        if len(op) > 1:
            ops.append(op)
    api.batch(ops)


def solve_signed():
    sess = session()
    rows, page = [], 1
    while True:
        status, _, data = call("GET", f"/api/orders?channel=legacy_store&page={page}")
        rows += data["orders"]
        if page >= data["pages"]:
            break
        page += 1
    for o in rows:
        archive = o["status"] == "delivered" and o["delivered_at"][:10] < "2026-10-01"
        tags = o["tags"] + ([] if "migrated" in o["tags"] else ["migrated"])
        status, _, body = signed(sess, "PATCH", f"/api/orders/{o['id']}", {"tags": tags, "status": "archived" if archive else o["status"]})
        assert status == 200, body


def check():
    return call("GET", "/api/check")[2]


def case(name, expect_pass, steps, label=None):
    call("POST", "/api/reset")
    steps()
    result = check()
    ok = result["pass"] == expect_pass and (result["completed_at_ms"] is not None) == expect_pass
    if label:
        ok = ok and result["method"]["label"] == label
    broken = [k for k, v in result["invariants"].items() if not v]
    print(f"{'ok  ' if ok else 'FAIL'} {name}: pass={result['pass']} matched={result['matched']}/{result['total']} "
          f"method={result['method']['label']}{' broken=' + ','.join(broken) if broken else ''}")
    if not ok:
        failures.append(name)
    return result


def solve(**options):
    return lambda: solve_public(Api(token()), **options)


def processing_archived():
    api = Api(token())
    solve_public(api)
    stuck = api.list_all(channel="legacy_store", status="processing")
    api.batch([{"id": o["id"], "status": "archived"} for o in stuck])


call("POST", "/api/reset")
fresh = case("fresh state fails", False, lambda: None)
dump = json.dumps(fresh)
leaks = [w for w in ("expected", "target", "should_be_", "#1") if w in dump]
leaks += [str(oid) for oid in re.findall(r"\b5\d{6}\b", dump)]
note(not leaks, f"check leaks no answers{': ' + ', '.join(leaks) if leaks else ''}")

case("correct solution via the public API passes", True, solve(), label="public_api")
case("correct solution via signed internal requests passes", True, solve_signed, label="ui")

call("POST", "/api/reset")
target = call("GET", "/api/orders?channel=legacy_store")[2]["orders"][0]
status, _, body = call("PATCH", f"/api/orders/{target['id']}", {"tags": target["tags"] + ["migrated"]})
note(status == 403, f"unsigned internal write is rejected: {status} {body}")
sess = session()
status, _, _ = call("PATCH", f"/api/orders/{target['id']}", json.dumps({"tags": ["migrated"]}).encode(),
                    {"Cookie": sess["cookie"], "X-CSRF-Token": sess["csrf"], "X-Req-Nonce": "1-2", "X-Req-Sig": "0" * 32, "X-UI-Evt": "click:1:20"})
note(status == 403, f"internal write with a forged signature is rejected: {status}")
result = check()
note(result["details"]["orders_changed"] == 0 and result["method"]["rejected"] == 2,
     f"rejected writes changed nothing and are counted: rejected={result['method']['rejected']}")

case("trap: archived the October 1 deliveries too", False, solve(archive_max="2026-10-02"))
case("trap: archived the legacy order still processing", False, processing_archived)
case("trap: tagged non-legacy orders whose notes mention legacy", False, solve(extra_tagged_query="legacy"))
case("trap: replaced existing tags instead of adding", False, solve(replace_tags=True))
case("trap: stopped after the first page of legacy orders", False, solve(first_page_only=True))
case("trap: archived delivered orders from every channel", False, solve(archive_channel=None))
case("trap: cut off at UTC midnight", False, solve(archive_max="2026-10-01T00:00:00Z"))
case("trap: cut off at September 30", False, solve(archive_max="2026-09-30"))
case("trap: tagged but archived nothing", False, solve(archive=False))
case("trap: archived but tagged nothing", False, solve(tag=False))

call("POST", "/api/reset")
api = Api(token())
some = api.list_all(first_page_only=True, channel="legacy_store", limit=1)[0]
status, data = api.request("PATCH", f"/v1/orders/{some['id']}", {"tags_add": ["bad,tag"]})
note(status == 422 and data["error"]["param"] == "tags_add", f"invalid tag is rejected with 422: {status}")
status, data = api.request("PATCH", f"/v1/orders/{some['id']}", {"status": "cancelled"})
note(status == 422 and data["error"]["param"] == "status", f"unknown status is rejected with 422: {status}")
status, _, data = call("GET", "/v1/orders", headers={"Authorization": "Bearer sfa_live_wrong"})
note(status == 401 and data["error"]["code"] == "unauthorized", f"bad token is rejected with 401: {status}")
note(check()["invariants"]["valid_order_states"] and check()["details"]["orders_changed"] == 0, "rejected API writes changed nothing")

time.sleep(1.2)
codes, retry = [], None
for _ in range(25):
    status, headers, _ = call("GET", "/v1/orders?limit=1", headers=api.auth)
    codes.append(status)
    if status == 429:
        retry = headers.get("Retry-After")
note(codes.count(200) >= 10 and 429 in codes and retry and retry.isdigit(),
     f"rate limit: {codes.count(200)} ok then 429 with Retry-After={retry}")
time.sleep(float(retry or 1) + 0.1)
status, _, _ = call("GET", "/v1/orders?limit=1", headers=api.auth)
note(status == 200, f"after Retry-After the API answers again: {status}")

case("reset restores state, correct run passes again", True, solve(), label="public_api")
call("POST", "/api/reset")
sys.exit(1 if failures else 0)
