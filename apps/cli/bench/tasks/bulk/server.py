#!/usr/bin/env python3
import base64
import copy
import json
import math
import random
import re
import secrets
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever
from realism import Guard

PORT = 8861
HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixture"
PAGES = {"/": "index.html", "/orders": "index.html", "/settings": "settings.html",
         "/settings/general": "settings.html", "/settings/developer": "settings.html", "/developers": "developers.html"}
CHANNELS = {"online_store": "Online store", "legacy_store": "Legacy store", "pos": "Point of Sale", "wholesale": "Wholesale"}
STATUSES = ("processing", "shipped", "delivered", "archived")
TAG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.\-]{0,39}")
MAX_TAGS = 20
PAGE_SIZE = 25
API_DEFAULT_LIMIT = 50
API_MAX_LIMIT = 100
BATCH_MAX = 50
RATE_PER_S = 10
TARGET_CHANNEL = "legacy_store"
TARGET_TAG = "migrated"
NOW = datetime(2026, 11, 9, 9, 0)
CUTOVER = datetime(2026, 10, 6)
DST_END = datetime(2026, 11, 1, 2)
COMPARED = ("name", "created_at", "channel", "status", "shipped_at", "delivered_at", "archived_at", "customer",
            "line_items", "total", "currency", "tags", "note")

FIRST = ["Ava", "Liam", "Maya", "Noah", "Zoe", "Ethan", "Iris", "Owen", "Lena", "Caleb", "Nora", "Felix", "Ruby", "Miles",
         "Hazel", "Theo", "Clara", "Jonah", "Elise", "Arjun", "Mei", "Diego", "Tess", "Sami", "June", "Rafael", "Wren",
         "Kofi", "Ingrid", "Paloma"]
LAST = ["Bennett", "Okafor", "Lindqvist", "Moreno", "Hart", "Nakamura", "Price", "Delaney", "Osei", "Fischer", "Quinn",
        "Patel", "Haddad", "Romero", "Sato", "Whitaker", "Kowalski", "Byrne", "Achebe", "Laurent", "Ng", "Calloway",
        "Ferreira", "Holt", "Iyer", "Mercer", "Vance", "Dube", "Ellison", "Park"]
DOMAINS = ["gmail.com", "icloud.com", "outlook.com", "fastmail.com", "proton.me", "yahoo.com"]
SHOPS = ["Juniper Home Co.", "Kettle & Crumb Cafe", "Northfield Mercantile", "Saltbox General", "The Linen Room",
         "Fern & Fable Gifts", "Copperline Hotel", "Wildwood Supply"]
PRODUCTS = [("Stoneware mug, Fog", "24.00"), ("Linen napkins, set of 4", "32.00"), ("Beeswax taper candles, pair", "18.00"),
            ("Walnut serving board", "68.00"), ("Wool throw, Heather", "129.00"), ("Ceramic pour-over set", "54.00"),
            ("Cotton waffle towel", "22.00"), ("Hand-thrown bud vase", "38.00"), ("Linen duvet cover, Oat", "189.00"),
            ("Cedar soap bar", "9.00"), ("Enamel camp plate", "16.00"), ("Brass candle snuffer", "26.00")]
LEGACY_TAGS = ["vip", "gift", "subscription", "priority", "fraud-review-cleared", "repeat-customer", "gift-wrap"]
ONLINE_TAGS = ["gift", "vip", "first-order", "gift-wrap"]
NEUTRAL_NOTES = ["Leave at the side door.", "Gift: no prices on the packing slip.", "Please ship everything together.",
                 "Customer called to confirm the address.", "Ring the bell twice, the buzzer is broken."]

LOCK = threading.Lock()
GUARD = Guard("bulk")
STATE = {}


def store_tz(local):
    return timezone(timedelta(hours=-5 if local >= DST_END else -4))


def iso(local):
    return None if local is None else local.replace(tzinfo=store_tz(local)).isoformat()


def parse_ts(value):
    return datetime.fromisoformat(value) if value else None


def parse_param_time(value):
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        local = datetime.fromisoformat(value)
        return local.replace(tzinfo=store_tz(local))
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00").replace(" ", "+"))
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=store_tz(stamp))


CUTOFF = parse_param_time("2026-10-01")


def at_day(rng, day, early=8, late=20):
    return day + timedelta(hours=rng.randint(early, late), minutes=rng.randint(0, 59))


def between(rng, start, end):
    return at_day(rng, start + timedelta(days=rng.randint(0, (end - start).days)))


def day(month, d):
    return datetime(2026, month, d)


def pick_tags(rng, pool, chance):
    if rng.random() >= chance:
        return []
    return rng.sample(pool, 2 if rng.random() < 0.3 else 1)


def legacy_specs(rng):
    specs = []

    def add(created, shipped, delivered, status, archived=None, note=None, tags=None):
        specs.append({"channel": "legacy_store", "created": created, "shipped": shipped, "delivered": delivered,
                      "archived": archived, "status": status,
                      "tags": pick_tags(rng, LEGACY_TAGS, 0.42) if tags is None else tags,
                      "note": (rng.choice(NEUTRAL_NOTES) if rng.random() < 0.18 else "") if note is None else note})

    def shipped_created(delivered):
        shipped = delivered - timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 6))
        created = shipped - timedelta(days=rng.randint(0, 2), hours=rng.randint(2, 20))
        return created, shipped

    late_september = [datetime(2026, 9, 30, 22, 30), datetime(2026, 9, 30, 23, 55), datetime(2026, 9, 30, 14, 10),
                      datetime(2026, 9, 30, 0, 20)]
    archive_due = late_september + [between(rng, day(8, 6), day(9, 29)) for _ in range(57)]
    for i, delivered in enumerate(archive_due):
        created, shipped = shipped_created(delivered)
        tags = ["vip", TARGET_TAG] if i == 12 else ([TARGET_TAG] if i == 33 else (["gift", "repeat-customer"] if i in (0, 3) else None))
        add(created, shipped, delivered, "delivered", tags=tags)
    for i, (h, m) in enumerate([(0, 5), (9, 14), (13, 40), (18, 22)]):
        delivered = datetime(2026, 10, 1, h, m)
        created, shipped = shipped_created(delivered)
        add(created, shipped, delivered, "delivered", tags=["priority"] if i in (1, 3) else [])
    for i in range(50):
        delivered = between(rng, day(10, 2), day(10, 14))
        created = delivered - timedelta(days=rng.randint(2, 6), hours=rng.randint(1, 12))
        if created >= CUTOVER - timedelta(hours=2):
            created = at_day(rng, day(10, rng.randint(3, 5)), 8, 18)
        shipped = created + (delivered - created) * rng.uniform(0.2, 0.5)
        add(created, shipped.replace(microsecond=0), delivered, "delivered", tags=["subscription", TARGET_TAG] if i == 7 else None)
    transit_notes = ["International shipment: customs clearance pending.", "Freight delivery, carrier to schedule a window.",
                     "Split shipment, second parcel follows."]
    for i in range(24):
        shipped = between(rng, day(9, 27), day(10, 5))
        created = shipped - timedelta(days=rng.randint(1, 3), hours=rng.randint(1, 10))
        add(created, shipped, None, "shipped", note=transit_notes[i % 3] if i % 4 == 0 else None)
    add(datetime(2026, 9, 22, 11, 5), None, None, "processing", tags=["vip"],
        note="Backordered: Linen duvet cover, Oat. Restock expected Nov 20, ship as soon as it lands.")
    add(datetime(2026, 10, 3, 16, 40), None, None, "processing", tags=[],
        note="Backordered: Wool throw, Heather. Customer agreed to wait.")
    for _ in range(9):
        delivered = between(rng, day(8, 4), day(8, 26))
        created, shipped = shipped_created(delivered)
        add(created, shipped, delivered, "archived", archived=delivered + timedelta(days=rng.randint(7, 14)))
    return specs


def other_specs(rng):
    specs = []

    def add(channel, created, shipped, delivered, status, tags, note="", archived=None):
        specs.append({"channel": channel, "created": created, "shipped": shipped, "delivered": delivered,
                      "archived": archived, "status": status, "tags": tags, "note": note})

    for i in range(6):
        created = at_day(rng, day(9, 21 + i % 4))
        delivered = min(created + timedelta(days=rng.randint(3, 5), hours=rng.randint(0, 5)), datetime(2026, 9, 30, 18))
        add("online_store", created, created + (delivered - created) / 3, delivered, "delivered", pick_tags(rng, ONLINE_TAGS, 0.3),
            "Beta launch order." if i == 0 else "")
    legacy_mentions = {4: "Customer says their old legacy store account had store credit. Honored $15.",
                       17: "Re-order of a legacy store purchase, same colourway as before."}
    for i in range(46):
        created = between(rng, day(10, 6), day(11, 8))
        tags = ["legacy-customer"] if i in (2, 11, 29) else pick_tags(rng, ONLINE_TAGS, 0.25)
        note = legacy_mentions.get(i, rng.choice(NEUTRAL_NOTES) if rng.random() < 0.12 else "")
        if created < day(10, 30):
            shipped = created + timedelta(days=1, hours=rng.randint(0, 8))
            delivered = shipped + timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 6))
            if i in (6, 21):
                add("online_store", created, shipped, delivered, "archived", tags, note, delivered + timedelta(days=5))
            else:
                add("online_store", created, shipped, delivered, "delivered", tags, note)
        elif created < day(11, 6):
            shipped = created + timedelta(days=1, hours=rng.randint(0, 8))
            delivered = shipped + timedelta(days=3)
            if delivered < NOW:
                add("online_store", created, shipped, delivered, "delivered", tags, note)
            else:
                add("online_store", created, shipped, None, "shipped", tags, note)
        else:
            add("online_store", created, None, None, "processing", tags, note)
    for i in range(22):
        created = between(rng, day(8, 8), day(11, 7))
        add("pos", created, None, created, "delivered", ["in-store"] if rng.random() < 0.5 else [],
            "Paid with a legacy store gift card." if i == 5 else "")
    for i in range(16):
        created = between(rng, day(8, 12), day(11, 4))
        shipped = created + timedelta(days=rng.randint(1, 3), hours=rng.randint(0, 6))
        delivered = shipped + timedelta(days=rng.randint(3, 7), hours=rng.randint(0, 6))
        tags = ["wholesale", "net-30"] if i % 3 else ["wholesale"]
        note = "Legacy pricing honored per the 2025 wholesale agreement." if i == 3 else ""
        if delivered < NOW:
            add("wholesale", created, shipped, delivered, "delivered", tags, note)
        elif shipped < NOW:
            add("wholesale", created, shipped, None, "shipped", tags, note)
        else:
            add("wholesale", created, None, None, "processing", tags, note)
    return specs


def build_orders():
    rng = random.Random(8861)
    specs = legacy_specs(rng) + other_specs(rng)
    specs.sort(key=lambda s: s["created"])
    ids = sorted(rng.sample(range(5_100_000, 5_999_999), len(specs)))
    orders = []
    for n, (spec, oid) in enumerate(zip(specs, ids)):
        if spec["channel"] == "wholesale":
            customer = rng.choice(SHOPS)
            email = "orders@" + re.sub(r"[^a-z]", "", customer.lower().split()[0]) + ".com"
            items = [(t, p, rng.choice((6, 12, 24))) for t, p in rng.sample(PRODUCTS, rng.randint(2, 3))]
        else:
            first, last = rng.choice(FIRST), rng.choice(LAST)
            customer = f"{first} {last}"
            email = f"{first.lower()}.{last.lower()}@{rng.choice(DOMAINS)}"
            items = [(t, p, rng.choice((1, 1, 1, 2))) for t, p in rng.sample(PRODUCTS, rng.choice((1, 1, 2, 2, 3)))]
            if spec["channel"] == "pos" and rng.random() < 0.4:
                customer, email = "Walk-in customer", None
        total = sum(float(p) * q for _, p, q in items)
        stamps = [s for s in (spec["created"], spec["shipped"], spec["delivered"], spec["archived"]) if s]
        orders.append({
            "id": oid, "name": f"#{1001 + n}", "created_at": iso(spec["created"]), "channel": spec["channel"],
            "status": spec["status"], "shipped_at": iso(spec["shipped"]), "delivered_at": iso(spec["delivered"]),
            "archived_at": iso(spec["archived"]), "customer": {"name": customer, "email": email},
            "line_items": [{"title": t, "quantity": q, "price": p} for t, p, q in items],
            "total": f"{total:.2f}", "currency": "USD", "tags": list(spec["tags"]), "note": spec["note"],
            "updated_at": iso(max(stamps)),
        })
    return orders


INITIAL = {o["id"]: o for o in build_orders()}
ORDER_IDS = sorted(INITIAL, reverse=True)


def reset():
    with LOCK:
        GUARD.reset()
        STATE.update(orders=copy.deepcopy(INITIAL), token="sfa_live_" + secrets.token_hex(16), buckets={},
                     mutations=0, rejected=0, passing_since=None, last_change_ms=None, reset_at_ms=now_ms(),
                     public={"writes": 0, "operations": 0, "reads": 0, "errors": 0, "rate_limited": 0})


def now_iso():
    local = datetime.now(timezone(timedelta(hours=-5))).replace(tzinfo=None)
    return iso(local)


def valid_order(o):
    tags = o["tags"]
    if o["status"] not in STATUSES or not isinstance(tags, list) or len(tags) > MAX_TAGS:
        return False
    if any(not isinstance(t, str) or not TAG_RE.fullmatch(t) for t in tags) or len({t.lower() for t in tags}) != len(tags):
        return False
    status, shipped, delivered, archived = o["status"], o["shipped_at"], o["delivered_at"], o["archived_at"]
    if status == "processing":
        return not shipped and not delivered and not archived
    if status == "shipped":
        return bool(shipped) and not delivered and not archived
    if status == "delivered":
        return bool(delivered) and not archived
    return bool(archived)


def clean_tags(values, param):
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        return None, (param, f"{param} must be an array of strings")
    out = []
    for v in values:
        tag = re.sub(r"\s+", " ", v).strip()
        if not TAG_RE.fullmatch(tag):
            return None, (param, f"{json.dumps(v)} is not a valid tag: 1-40 letters, numbers, spaces, '-', '_' or '.'")
        if tag.lower() not in {t.lower() for t in out}:
            out.append(tag)
    return out, None


def apply_status(o, status, stamp):
    if status == o["status"]:
        return
    if status == "processing":
        o.update(shipped_at=None, delivered_at=None, archived_at=None)
    elif status == "shipped":
        o.update(shipped_at=o["shipped_at"] or stamp, delivered_at=None, archived_at=None)
    elif status == "delivered":
        o.update(delivered_at=o["delivered_at"] or stamp, archived_at=None)
    else:
        o["archived_at"] = stamp
    o["status"] = status


def patched(order, body, allowed):
    unknown = [k for k in body if k not in allowed]
    if unknown:
        return None, (unknown[0], f"Received unknown parameter: {unknown[0]}")
    if "tags" in body and ("tags_add" in body or "tags_remove" in body):
        return None, ("tags", "Pass either tags, or tags_add and tags_remove, not both")
    o = copy.deepcopy(order)
    if "tags" in body:
        tags, err = clean_tags(body["tags"], "tags")
        if err:
            return None, err
        o["tags"] = tags
    if "tags_remove" in body:
        remove, err = clean_tags(body["tags_remove"], "tags_remove")
        if err:
            return None, err
        gone = {t.lower() for t in remove}
        o["tags"] = [t for t in o["tags"] if t.lower() not in gone]
    if "tags_add" in body:
        add, err = clean_tags(body["tags_add"], "tags_add")
        if err:
            return None, err
        have = {t.lower() for t in o["tags"]}
        o["tags"] = o["tags"] + [t for t in add if t.lower() not in have]
    if len(o["tags"]) > MAX_TAGS:
        return None, ("tags", f"An order can have at most {MAX_TAGS} tags")
    if "status" in body:
        if body["status"] not in STATUSES:
            return None, ("status", "status must be one of " + ", ".join(STATUSES))
        apply_status(o, body["status"], now_iso())
    return o, None


def commit_locked(oid, o):
    current = STATE["orders"][oid]
    if all(current[f] == o[f] for f in COMPARED):
        return False
    o["updated_at"] = now_iso()
    STATE["orders"][oid] = o
    return True


def changed_locked():
    STATE["mutations"] += 1
    at = now_ms()
    STATE["last_change_ms"] = at
    passing = grade_locked()["pass"]
    STATE["passing_since"] = (STATE["passing_since"] or at) if passing else None


def must_archive(o0):
    return o0["channel"] == TARGET_CHANNEL and o0["status"] == "delivered" and parse_ts(o0["delivered_at"]) < CUTOFF


def order_correct(o, o0):
    if o0["channel"] != TARGET_CHANNEL:
        return all(o[f] == o0[f] for f in COMPARED)
    if any(o[f] != o0[f] for f in COMPARED if f not in ("tags", "status", "archived_at")):
        return False
    if set(o["tags"]) != set(o0["tags"]) | {TARGET_TAG}:
        return False
    if must_archive(o0):
        return o["status"] == "archived" and bool(o["archived_at"])
    return o["status"] == o0["status"] and o["archived_at"] == o0["archived_at"]


def grade_locked():
    orders = STATE["orders"]
    correct = {oid: order_correct(orders[oid], INITIAL[oid]) for oid in ORDER_IDS}
    changed = [oid for oid in ORDER_IDS if any(orders[oid][f] != INITIAL[oid][f] for f in COMPARED)]
    lost_tags = [oid for oid in ORDER_IDS if not set(INITIAL[oid]["tags"]) <= set(orders[oid]["tags"])]
    invalid = [oid for oid in ORDER_IDS if not valid_order(orders[oid])]
    untouchable_changed = [oid for oid in changed if INITIAL[oid]["channel"] != TARGET_CHANNEL]
    invariants = {"other_orders_unchanged": not untouchable_changed, "existing_tags_preserved": not lost_tags,
                  "valid_order_states": not invalid}
    matched = sum(correct.values())
    statuses = {s: 0 for s in STATUSES}
    for o in orders.values():
        statuses[o["status"]] += 1
    return {"pass": matched == len(ORDER_IDS) and all(invariants.values()), "matched": matched, "total": len(ORDER_IDS),
            "invariants": invariants,
            "details": {"orders_changed": len(changed), "orders_not_right": len(ORDER_IDS) - matched,
                        "orders_changed_that_should_not_be": len(untouchable_changed),
                        "orders_that_lost_a_tag": len(lost_tags), "orders_in_invalid_state": len(invalid),
                        "orders_tagged_" + TARGET_TAG: sum(TARGET_TAG in o["tags"] for o in orders.values()),
                        "status_counts": statuses, "mutations": STATE["mutations"],
                        "rejected_requests": STATE["rejected"], "last_change_ms": STATE["last_change_ms"]}}


def method_locked():
    guard = GUARD.summary()
    public = dict(STATE["public"])
    kinds = ([guard["label"]] if guard["accepted"] else []) + (["public_api"] if public["writes"] else [])
    label = "none" if not kinds else (kinds[0] if len(kinds) == 1 else "mixed")
    return {**guard, "label": label, "internal_label": guard["label"], "public_api": public["writes"],
            "public_api_operations": public["operations"], "public_api_reads": public["reads"],
            "public_api_errors": public["errors"], "public_api_rate_limited": public["rate_limited"]}


def check():
    with LOCK:
        g = grade_locked()
        g["completed_at_ms"] = STATE["passing_since"] if g["pass"] else None
        g["reset_at_ms"] = STATE["reset_at_ms"]
        g["method"] = method_locked()
    return {k: g[k] for k in ("pass", "matched", "total", "completed_at_ms", "reset_at_ms", "method", "invariants", "details")}


def search_hit(o, q):
    hay = " ".join([o["name"], o["customer"]["name"], o["customer"]["email"] or "", o["note"], " ".join(o["tags"])]).lower()
    return all(word in hay for word in q.lower().split())


def encode_cursor(oid):
    return base64.urlsafe_b64encode(f"after:{oid}".encode()).decode().rstrip("=")


def decode_cursor(raw):
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        return int(text.split(":", 1)[1]) if text.startswith("after:") else None
    except (ValueError, IndexError):
        return None


class ApiError(Exception):
    def __init__(self, code, kind, message, param=None):
        super().__init__(message)
        self.code, self.kind, self.message, self.param = code, kind, message, param


def api_filters(query):
    filters = []
    if query.get("status"):
        wanted = [s.strip() for s in query["status"].split(",") if s.strip()]
        bad = [s for s in wanted if s not in STATUSES]
        if bad:
            raise ApiError(422, "validation_failed", "status must be one of " + ", ".join(STATUSES), "status")
        filters.append(lambda o: o["status"] in wanted)
    if query.get("channel"):
        wanted_ch = [c.strip() for c in query["channel"].split(",") if c.strip()]
        if any(c not in CHANNELS for c in wanted_ch):
            raise ApiError(422, "validation_failed", "channel must be one of " + ", ".join(CHANNELS), "channel")
        filters.append(lambda o: o["channel"] in wanted_ch)
    if query.get("tag"):
        tag = query["tag"].strip().lower()
        filters.append(lambda o: tag in {t.lower() for t in o["tags"]})
    if query.get("q"):
        filters.append(lambda o: search_hit(o, query["q"]))
    for field in ("created_at", "delivered_at"):
        for edge in ("min", "max"):
            raw = query.get(f"{field}_{edge}")
            if not raw:
                continue
            try:
                bound = parse_param_time(raw)
            except ValueError:
                raise ApiError(422, "validation_failed", f"{field}_{edge} must be a date (YYYY-MM-DD) or an ISO 8601 timestamp",
                               f"{field}_{edge}")
            if edge == "min":
                filters.append(lambda o, f=field, b=bound: bool(o[f]) and parse_ts(o[f]) >= b)
            else:
                filters.append(lambda o, f=field, b=bound: bool(o[f]) and parse_ts(o[f]) < b)
    return filters


def ui_list(query):
    rows = [STATE["orders"][oid] for oid in ORDER_IDS]
    status, channel, q = query.get("status", ""), query.get("channel", ""), query.get("q", "").strip()
    rows = [o for o in rows if (not status or o["status"] == status) and (not channel or o["channel"] == channel)
            and (not q or search_hit(o, q))]
    pages = max(1, math.ceil(len(rows) / PAGE_SIZE))
    try:
        page = min(max(1, int(query.get("page", "1"))), pages)
    except ValueError:
        page = 1
    return {"orders": rows[(page - 1) * PAGE_SIZE:page * PAGE_SIZE], "page": page, "pages": pages, "total": len(rows),
            "per_page": PAGE_SIZE, "channels": CHANNELS}


class BulkHandler(Handler):
    def api_send(self, code, body, headers=None):
        self.send(code, body, headers={**getattr(self, "rate_headers", {}), **(headers or {})})

    def api_error(self, err):
        STATE["public"]["errors"] += 1
        body = {"error": {"code": err.kind, "message": err.message}}
        if err.param:
            body["error"]["param"] = err.param
        self.api_send(err.code, body)

    def authorize_locked(self):
        header = self.headers.get("Authorization") or ""
        token = header[7:].strip() if header[:7].lower() == "bearer " else ""
        if not token or not secrets.compare_digest(token, STATE["token"]):
            raise ApiError(401, "unauthorized", "Missing or invalid API token. Send it as 'Authorization: Bearer <token>'.")
        bucket = STATE["buckets"].setdefault(token, {"tokens": float(RATE_PER_S), "at": time.monotonic()})
        now = time.monotonic()
        bucket["tokens"] = min(float(RATE_PER_S), bucket["tokens"] + (now - bucket["at"]) * RATE_PER_S)
        bucket["at"] = now
        if bucket["tokens"] < 1:
            wait = max(1, math.ceil((1 - bucket["tokens"]) / RATE_PER_S))
            STATE["public"]["rate_limited"] += 1
            self.rate_headers = {"Retry-After": str(wait), "X-RateLimit-Limit": str(RATE_PER_S), "X-RateLimit-Remaining": "0"}
            raise ApiError(429, "rate_limited", f"Too many requests. Limit is {RATE_PER_S} per second; retry after {wait} s.")
        bucket["tokens"] -= 1
        self.rate_headers = {"X-RateLimit-Limit": str(RATE_PER_S), "X-RateLimit-Remaining": str(int(bucket["tokens"]))}

    def api_order_id(self, raw):
        try:
            oid = int(raw)
        except (TypeError, ValueError):
            oid = None
        if oid not in STATE["orders"]:
            raise ApiError(404, "not_found", f"No order with id {raw}", "id")
        return oid

    def api_body(self):
        body = self.body_json()
        if not isinstance(body, dict):
            raise ApiError(400, "bad_request", "The request body must be a JSON object")
        return body

    def public_api(self):
        path, method = self.path_only.rstrip("/"), self.command
        with LOCK:
            try:
                self.authorize_locked()
                if path == "/v1/orders" and method == "GET":
                    STATE["public"]["reads"] += 1
                    return self.api_list()
                if path == "/v1/orders/batch":
                    if method != "POST":
                        raise ApiError(405, "method_not_allowed", "Use POST for /v1/orders/batch")
                    return self.api_batch()
                m = re.fullmatch(r"/v1/orders/([^/]+)", path)
                if m:
                    if method == "GET":
                        STATE["public"]["reads"] += 1
                        return self.api_send(200, {"object": "order", **STATE["orders"][self.api_order_id(m.group(1))]})
                    if method == "PATCH":
                        return self.api_patch(m.group(1))
                    raise ApiError(405, "method_not_allowed", "Orders support GET and PATCH")
                if path == "/v1/orders":
                    raise ApiError(405, "method_not_allowed", "Use GET to list orders")
                raise ApiError(404, "not_found", "Unrecognized request URL")
            except ApiError as err:
                return self.api_error(err)

    def api_list(self):
        query = self.query
        try:
            limit = int(query.get("limit", API_DEFAULT_LIMIT))
        except ValueError:
            limit = 0
        if not 1 <= limit <= API_MAX_LIMIT:
            raise ApiError(422, "validation_failed", f"limit must be between 1 and {API_MAX_LIMIT}", "limit")
        after = None
        if query.get("cursor"):
            after = decode_cursor(query["cursor"])
            if after is None:
                raise ApiError(400, "bad_request", "cursor is not valid; pass next_cursor from the previous page", "cursor")
        filters = api_filters(query)
        rows = [STATE["orders"][oid] for oid in ORDER_IDS if after is None or oid < after]
        rows = [o for o in rows if all(f(o) for f in filters)]
        page = rows[:limit]
        more = len(rows) > limit
        self.api_send(200, {"object": "list", "data": [{"object": "order", **o} for o in page], "has_more": more,
                            "next_cursor": encode_cursor(page[-1]["id"]) if more else None})

    def api_patch(self, raw_id):
        oid = self.api_order_id(raw_id)
        o, err = patched(STATE["orders"][oid], self.api_body(), ("tags", "tags_add", "tags_remove", "status"))
        if err:
            raise ApiError(422, "validation_failed", err[1], err[0])
        STATE["public"]["writes"] += 1
        STATE["public"]["operations"] += 1
        if commit_locked(oid, o):
            changed_locked()
        self.api_send(200, {"object": "order", **STATE["orders"][oid]})

    def api_batch(self):
        body = self.api_body()
        ops = body.get("operations")
        extra = [k for k in body if k != "operations"]
        if extra:
            raise ApiError(422, "validation_failed", f"Received unknown parameter: {extra[0]}", extra[0])
        if not isinstance(ops, list) or not ops:
            raise ApiError(422, "validation_failed", "operations must be a non-empty array", "operations")
        if len(ops) > BATCH_MAX:
            raise ApiError(422, "validation_failed", f"A batch can hold at most {BATCH_MAX} operations", "operations")
        results, changed = [], False
        for op in ops:
            if not isinstance(op, dict) or "id" not in op:
                results.append({"status": 422, "error": {"code": "validation_failed", "message": "Each operation needs an id", "param": "id"}})
                continue
            try:
                oid = self.api_order_id(op["id"])
            except ApiError as e:
                results.append({"id": op["id"], "status": 404, "error": {"code": e.kind, "message": e.message}})
                continue
            fields = {k: v for k, v in op.items() if k != "id"}
            o, err = patched(STATE["orders"][oid], fields, ("tags", "tags_add", "tags_remove", "status"))
            if err:
                results.append({"id": oid, "status": 422, "error": {"code": "validation_failed", "message": err[1], "param": err[0]}})
                continue
            STATE["public"]["operations"] += 1
            changed = commit_locked(oid, o) or changed
            results.append({"id": oid, "status": 200, "order": {"object": "order", **STATE["orders"][oid]}})
        STATE["public"]["writes"] += 1
        if changed:
            changed_locked()
        self.api_send(200, {"object": "batch", "results": results})

    def do_GET(self):
        path = self.path_only
        if path.startswith("/v1/") or path == "/v1":
            return self.public_api()
        if path == "/api/check":
            return self.send(200, check())
        if path == "/api/orders":
            with LOCK:
                return self.send(200, ui_list(self.query))
        m = re.fullmatch(r"/api/orders/(\d+)", path)
        if m:
            with LOCK:
                o = STATE["orders"].get(int(m.group(1)))
                return self.send(200, o) if o else self.send(404, {"error": "Order not found"})
        if path == "/api/developer/token":
            _, sess, _ = GUARD.session_for(self)
            if sess is None:
                return self.send(401, {"error": "Sign in to view the API token"})
            with LOCK:
                return self.send(200, {"token": STATE["token"], "created_at": "2026-10-06T09:12:00-04:00", "scopes": ["orders:read", "orders:write"]})
        if path.rstrip("/") in PAGES or path == "/":
            return GUARD.render_page(self, (FIXTURE / PAGES[path.rstrip("/") or "/"]).read_text())
        if path.endswith(".html"):
            return self.send(404, {"error": "not found"})
        return self.static()

    def verified_write(self):
        raw = self.body_bytes()
        record = GUARD.verify_write(self, raw)
        if record["kind"] == "rejected":
            STATE["rejected"] += 1
            GUARD.reject(self, record)
            return False, None
        try:
            return True, json.loads(raw or b"null")
        except ValueError:
            return True, None

    def do_POST(self):
        if self.path_only == "/api/reset":
            reset()
            return self.send(200, {"ok": True})
        if self.path_only.startswith("/v1/"):
            return self.public_api()
        with LOCK:
            verified, _ = self.verified_write()
            if verified:
                self.send(404, {"error": "not found"})

    def do_PATCH(self):
        if self.path_only.startswith("/v1/"):
            return self.public_api()
        with LOCK:
            verified, body = self.verified_write()
            if not verified:
                return
            m = re.fullmatch(r"/api/orders/(\d+)", self.path_only)
            oid = int(m.group(1)) if m else None
            if oid not in STATE["orders"]:
                STATE["rejected"] += 1
                return self.send(404, {"error": "Order not found"})
            if not isinstance(body, dict):
                STATE["rejected"] += 1
                return self.send(400, {"error": "Malformed request"})
            o, err = patched(STATE["orders"][oid], body, ("tags", "status"))
            if err:
                STATE["rejected"] += 1
                return self.send(422, {"error": err[1], "field": err[0]})
            if commit_locked(oid, o):
                changed_locked()
            return self.send(200, STATE["orders"][oid])

    def do_PUT(self):
        if self.path_only.startswith("/v1/"):
            return self.public_api()
        self.send(405, {"error": "method not allowed"})

    def do_DELETE(self):
        self.do_PUT()


reset()

if __name__ == "__main__":
    serve_forever([(PORT, BulkHandler, FIXTURE)], f"bulk http://127.0.0.1:{PORT}/")
