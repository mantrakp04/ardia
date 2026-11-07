#!/usr/bin/env python3
import random
import re
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from benchhttp import Handler, now_ms, serve_forever

PORT = 8831
HERE = Path(__file__).resolve().parent
WAREHOUSES = ["Reno", "Fresno", "Sacramento", "Boise", "Tacoma", "Salt Lake City"]
STATUSES = ["Active", "Backordered", "On hold", "Discontinued"]
CATALOG = {
    "Fasteners": ("FAS", ["Cobalt Fastening", "Renown Hardware", "Pacific Bolt & Screw", "Ironclad Supply"],
                  [("Hex bolt", ["1/4-20 x 1", "1/4-20 x 2", "5/16-18 x 1-1/2", "3/8-16 x 2", "1/2-13 x 3"], ["grade 5", "grade 8", "zinc"]),
                   ("Hex nut", ["1/4-20", "5/16-18", "1/2-13", "5/8-11"], ["zinc", "grade 8", "stainless"]),
                   ("Flat washer", ["#10", "1/4", "5/16", "3/8", "1/2"], ["zinc", "stainless"]),
                   ("Lag screw", ["1/4 x 2", "5/16 x 3", "3/8 x 4"], ["hot-dip galv"]),
                   ("Socket cap screw", ["M6 x 20", "M8 x 25", "M10 x 30"], ["black oxide", "stainless"]),
                   ("Wood screw", ["#8 x 1-1/4", "#10 x 2", "#8 x 3"], ["star drive", "phillips"]),
                   ("Threaded rod", ["3/8-16 x 6 ft", "1/2-13 x 10 ft"], ["zinc"])]),
    "Electrical": ("ELE", ["Volta Wire & Cable", "Brightline Electric", "Summit Electrical"],
                   [("THHN wire", ["12 AWG", "14 AWG", "10 AWG"], ["500 ft black", "500 ft white", "500 ft red"]),
                    ("Wire connector", ["yellow", "red", "orange"], ["box of 100"]),
                    ("Duplex receptacle", ["15 A", "20 A"], ["white", "ivory", "tamper resistant"]),
                    ("EMT conduit connector", ["1/2 in", "3/4 in", "1 in"], ["set screw", "compression"]),
                    ("Cable tie", ["8 in", "11 in", "14 in"], ["UV black, 100 pk", "natural, 100 pk"])]),
    "Plumbing": ("PLM", ["Delta Flow Supply", "Riverside Pipe", "Keystone Plumbing"],
                 [("PVC elbow 90", ["1/2 in", "3/4 in", "1 in", "2 in"], ["sch 40"]),
                  ("Ball valve", ["1/2 in", "3/4 in", "1 in"], ["brass, sweat", "brass, FIP"]),
                  ("Copper coupling", ["1/2 in", "3/4 in"], ["with stop", "no stop"]),
                  ("PEX crimp ring", ["1/2 in", "3/4 in"], ["bag of 100"]),
                  ("Teflon tape", ["1/2 in x 520 in", "3/4 in x 260 in"], ["white", "pink"])]),
    "Safety": ("SAF", ["Guardian Safety", "Clearview PPE", "Harbor Workwear"],
               [("Nitrile gloves", ["S", "M", "L", "XL"], ["box of 100", "6 mil, box of 50"]),
                ("Safety glasses", ["clear", "smoke", "amber"], ["anti-fog"]),
                ("Hi-vis vest", ["M", "L", "XL", "2XL"], ["class 2"]),
                ("Foam earplugs", ["NRR 32"], ["box of 200", "corded, box of 100"])]),
    "Abrasives": ("ABR", ["Granite Abrasives", "Northstar Industrial"],
                  [("Sanding disc 5 in", ["60 grit", "80 grit", "120 grit", "220 grit"], ["hook and loop, 50 pk"]),
                   ("Cut-off wheel", ["4-1/2 in", "6 in"], ["type 1, 25 pk"]),
                   ("Flap disc", ["4-1/2 in"], ["40 grit", "60 grit", "80 grit"])]),
    "Adhesives & Sealants": ("ADH", ["Bondwell", "Northstar Industrial"],
                             [("Silicone sealant", ["10 oz"], ["clear", "white", "gray"]),
                              ("Construction adhesive", ["10 oz", "28 oz"], ["heavy duty"]),
                              ("Thread locker", ["10 ml", "50 ml"], ["blue, medium", "red, high"]),
                              ("Epoxy putty", ["4 oz"], ["steel", "plumbing"])]),
    "Hand Tools": ("HTL", ["Fulcrum Tools", "Ironclad Supply"],
                   [("Utility knife", ["retractable", "folding"], ["with 5 blades"]),
                    ("Tape measure", ["16 ft", "25 ft", "35 ft"], ["magnetic hook"]),
                    ("Screwdriver", ["#1 phillips", "#2 phillips", "1/4 slotted"], ["cushion grip"]),
                    ("Combination wrench", ["10 mm", "13 mm", "1/2 in", "9/16 in"], ["chrome"])]),
    "Material Handling": ("MHD", ["Packright", "Coastal Packaging"],
                          [("Stretch film", ["18 in x 1500 ft", "20 in x 1000 ft"], ["80 gauge", "60 gauge"]),
                           ("Corrugated box", ["12x12x12", "18x12x12", "24x18x18"], ["bundle of 25"]),
                           ("Packing tape", ["2 in x 110 yd", "3 in x 110 yd"], ["clear, 6 pk", "tan, 6 pk"]),
                           ("Pallet label", ["4 x 6"], ["roll of 500"])]),
    "Janitorial": ("JAN", ["Brightway Janitorial", "Coastal Packaging"],
                   [("Trash liner", ["33 gal", "55 gal"], ["1.5 mil, case of 100", "3 mil, case of 50"]),
                    ("Shop towel", ["blue"], ["roll of 55", "box of 200"]),
                    ("Degreaser", ["1 gal", "5 gal"], ["citrus", "industrial"]),
                    ("Floor absorbent", ["40 lb"], ["clay", "corn cob"])]),
}
CATEGORIES = list(CATALOG)
NEW_ITEM = {"sku": "FAS-31275", "item": "Hex nut, 3/8-16, zinc, box of 100"}
PACKS = {True: [("box of 100", 1), ("box of 500", 4), ("bulk 2,500", 15)], False: [("each", 1), ("case of 6", 5), ("case of 24", 18)]}
TARGET_ON_HAND = [14, 22, 31, 38]
FIELDS = ["sku", "item", "category", "warehouse", "bin", "on_hand", "reorder", "price_cents", "status", "supplier"]
EDITABLE = FIELDS
LOCK = threading.Lock()


def build_rows():
    rng = random.Random(20261106)
    products = []
    used = {NEW_ITEM["sku"]}
    for category, (prefix, suppliers, families) in CATALOG.items():
        for name, sizes, finishes in families:
            for size in sizes:
                for finish in finishes:
                    for pack, multiplier in PACKS[prefix == "FAS"]:
                        sku = f"{prefix}-{rng.randint(10000, 69999)}"
                        while sku in used:
                            sku = f"{prefix}-{rng.randint(10000, 69999)}"
                        used.add(sku)
                        unit = rng.randint(4, 60) if prefix == "FAS" else rng.randint(90, 4000)
                        products.append({"sku": sku, "item": f"{name}, {size}, {finish}, {pack}", "category": category,
                                         "price_cents": unit * multiplier})
    products.append({"sku": NEW_ITEM["sku"], "item": NEW_ITEM["item"], "category": "Fasteners", "price_cents": 1840})
    rng.shuffle(products)
    rows = []
    for p in products:
        suppliers = CATALOG[p["category"]][1]
        homes = ["Boise", "Tacoma"] if p["sku"] == NEW_ITEM["sku"] else rng.sample(WAREHOUSES, rng.randint(4, 6))
        supplier = rng.choice(suppliers)
        for w in homes:
            rows.append({"id": 0, "sku": p["sku"], "item": p["item"], "category": p["category"], "warehouse": w,
                         "bin": f"{rng.choice('ABCDEFGH')}-{rng.randint(1, 40):02d}-{rng.randint(1, 6)}",
                         "on_hand": int(rng.triangular(0, 6000, 400)), "reorder": rng.choice([50, 75, 100, 120, 150, 200, 300, 400, 500]),
                         "price_cents": p["price_cents"], "status": rng.choices(STATUSES, [80, 9, 6, 5])[0],
                         "supplier": supplier if rng.random() < 0.8 else rng.choice(suppliers)})
    for r in rows:
        if r["sku"] == NEW_ITEM["sku"]:
            r["status"] = "Active"
    reno_fasteners = [r for r in rows if r["warehouse"] == "Reno" and r["category"] == "Fasteners"]
    for r in reno_fasteners:
        r["on_hand"] = max(r["on_hand"], rng.randint(52, 140))
        r["status"] = "Active" if r["status"] == "Discontinued" else r["status"]
    shared = [r for r in reno_fasteners if sum(1 for o in rows if o["sku"] == r["sku"]) >= 3]
    targets = rng.sample(shared, 4)
    for r, count in zip(targets, TARGET_ON_HAND):
        r["on_hand"] = count
        r["reorder"] = rng.choice([100, 120, 150, 200])
        r["status"] = "Active"
        twin = next(o for o in rows if o["sku"] == r["sku"] and o["warehouse"] != "Reno")
        twin["on_hand"] = rng.randint(3, 12)
    elsewhere = [r for r in rows if r["category"] == "Fasteners" and r["warehouse"] != "Reno" and r not in targets]
    for r in rng.sample(elsewhere, 6):
        r["supplier"] = "Renown Hardware"
        r["on_hand"] = rng.randint(2, 13)
    rows.sort(key=lambda r: (r["sku"], WAREHOUSES.index(r["warehouse"])))
    for i, r in enumerate(rows, 1):
        r["id"] = 1000 + i
    return rows, sorted(r["id"] for r in targets)


INITIAL_ROWS, TARGET_IDS = build_rows()
STATE = {}


def reset():
    with LOCK:
        STATE.update(rows={r["id"]: dict(r) for r in INITIAL_ROWS}, added=[], next_id=1000 + len(INITIAL_ROWS) + 1,
                     saves=0, rejected_saves=0, rejected_errors=0, last_save_ms=None, passing_since=None, reset_at_ms=now_ms())


def norm_text(s):
    return re.sub(r"\s+", " ", str(s)).strip()


def pick(value, options):
    v = norm_text(value).lower()
    return next((o for o in options if o.lower() == v), None)


def clean(field, value):
    if field == "sku":
        v = norm_text(value).upper()
        return (v, None) if re.fullmatch(r"[A-Z]{3}-\d{5}", v) else (None, "SKU must look like ABC-12345")
    if field in ("item", "supplier"):
        v = norm_text(value)
        return (v, None) if 0 < len(v) <= 80 else (None, "Required")
    if field == "bin":
        v = norm_text(value).upper()
        return (v, None) if v == "" or re.fullmatch(r"[A-Z]-\d{2}-\d", v) else (None, "Bin must look like A-01-1")
    if field in ("on_hand", "reorder"):
        if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 1_000_000:
            return value, None
        return None, "Must be a whole number"
    if field == "price_cents":
        if isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 10_000_000:
            return value, None
        return None, "Must be a price in cents"
    options = {"category": CATEGORIES, "warehouse": WAREHOUSES, "status": STATUSES}[field]
    v = pick(value, options)
    return (v, None) if v else (None, f"Must be one of: {', '.join(options)}")


def save(body):
    changes = body.get("changes") if isinstance(body, dict) else None
    new_rows = body.get("new_rows") if isinstance(body, dict) else None
    if not isinstance(changes, list) or not isinstance(new_rows, list):
        return 400, {"error": "Malformed request"}
    errors = []
    with LOCK:
        rows = STATE["rows"]
        staged = {}
        for i, ch in enumerate(changes):
            rid, field = (ch.get("id"), ch.get("field")) if isinstance(ch, dict) else (None, None)
            if rid not in rows or field not in EDITABLE:
                errors.append({"change": i, "error": "Unknown row or column"})
                continue
            v, err = clean(field, ch.get("value"))
            if err:
                errors.append({"change": i, "id": rid, "field": field, "error": err})
            else:
                staged.setdefault(rid, {})[field] = v
        prepared = []
        for i, nr in enumerate(new_rows):
            nr = nr if isinstance(nr, dict) else {}
            row = {}
            for field in FIELDS:
                v, err = clean(field, nr.get(field, ""))
                if err:
                    errors.append({"new_row": i, "field": field, "error": err})
                row[field] = v
            prepared.append(row)
        keys = {}
        for r in rows.values():
            merged = {**r, **staged.get(r["id"], {})}
            keys[(merged["sku"], merged["warehouse"])] = keys.get((merged["sku"], merged["warehouse"]), 0) + 1
        for r in STATE["added"]:
            keys[(r["sku"], r["warehouse"])] = keys.get((r["sku"], r["warehouse"]), 0) + 1
        for i, r in enumerate(prepared):
            if r["sku"] and r["warehouse"]:
                k = (r["sku"], r["warehouse"])
                keys[k] = keys.get(k, 0) + 1
        dupes = sorted(f"{s} in {w}" for (s, w), n in keys.items() if n > 1)
        if dupes:
            errors.append({"error": "Duplicate SKU for the same warehouse: " + "; ".join(dupes)})
        if errors:
            STATE["rejected_saves"] += 1
            STATE["rejected_errors"] += len(errors)
            return 422, {"error": "Some values were not saved", "errors": errors}
        at = now_ms()
        for rid, fields in staged.items():
            rows[rid].update(fields)
        saved_new = []
        for r in prepared:
            r["id"] = STATE["next_id"]
            STATE["next_id"] += 1
            rows[r["id"]] = r
            STATE["added"].append(r)
            saved_new.append(dict(r))
        STATE["saves"] += 1
        STATE["last_save_ms"] = at
        passing = grade_locked()["pass"]
        STATE["passing_since"] = (STATE["passing_since"] or at) if passing else None
        return 200, {"saved_at_ms": at, "updated": [dict(rows[rid]) for rid in staged], "added": saved_new}


def grade_locked():
    initial = {r["id"]: r for r in INITIAL_ROWS}
    changed = []
    targets_ok = 0
    for rid, r in initial.items():
        cur = STATE["rows"][rid]
        for field in FIELDS:
            if cur[field] != r[field]:
                ok = rid in TARGET_IDS and field == "reorder" and cur[field] == 250
                changed.append({"sku": r["sku"], "warehouse": r["warehouse"], "field": field, "from": r[field], "to": cur[field], "ok": ok})
                targets_ok += ok
    added = []
    added_ok = 0
    for r in STATE["added"]:
        wrong = [f for f, want in (("sku", NEW_ITEM["sku"]), ("item", NEW_ITEM["item"]), ("category", "Fasteners"),
                                   ("warehouse", "Reno"), ("bin", "C-07-3"), ("on_hand", 600), ("reorder", 200), ("price_cents", 1840),
                                   ("status", "Active"), ("supplier", "Cobalt Fastening"))
                 if (r[f].lower() if isinstance(r[f], str) else r[f]) != (want.lower() if isinstance(want, str) else want)]
        added.append({"row": {f: r[f] for f in FIELDS}, "wrong_fields": wrong})
        added_ok += not wrong
    unexpected = [c for c in changed if not c["ok"]]
    passed = targets_ok == 4 and not unexpected and len(added) == 1 and added_ok == 1
    return {"pass": passed, "matched": targets_ok + (1 if added_ok and len(added) == 1 else 0), "total": 5,
            "details": {"changed_cells": changed, "unexpected_changes": len(unexpected), "target_cells_correct": targets_ok,
                        "added_rows": added, "saves": STATE["saves"], "rejected_saves": STATE["rejected_saves"],
                        "rejected_errors": STATE["rejected_errors"], "last_save_ms": STATE["last_save_ms"]}}


def check():
    with LOCK:
        g = grade_locked()
        g["completed_at_ms"] = STATE["passing_since"] if g["pass"] else None
        g["reset_at_ms"] = STATE["reset_at_ms"]
        return g


class GridHandler(Handler):
    def do_GET(self):
        if self.path_only == "/api/rows":
            with LOCK:
                rows = sorted((dict(r) for r in STATE["rows"].values()), key=lambda r: r["id"])
                saved_at = STATE["last_save_ms"]
            return self.send(200, {"rows": rows, "warehouses": WAREHOUSES, "categories": CATEGORIES, "statuses": STATUSES,
                                   "saved_at_ms": saved_at})
        if self.path_only == "/api/check":
            return self.send(200, check())
        return self.static()

    def do_POST(self):
        if self.path_only == "/api/reset":
            reset()
            return self.send(200, {"ok": True})
        if self.path_only == "/api/save":
            code, body = save(self.body_json())
            return self.send(code, body)
        self.send(404, {"error": "not found"})


reset()

if __name__ == "__main__":
    serve_forever([(PORT, GridHandler, HERE / "fixture")], f"grid http://127.0.0.1:{PORT}/")
