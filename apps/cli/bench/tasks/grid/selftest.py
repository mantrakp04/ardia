#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8831"
NEW_ROW = {"sku": "FAS-31275", "item": "Hex nut, 3/8-16, zinc, box of 100", "category": "Fasteners", "warehouse": "Reno",
           "bin": "C-07-3", "on_hand": 600, "reorder": 200, "price_cents": 1840, "status": "Active", "supplier": "Cobalt Fastening"}
failures = []


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def rows():
    return call("GET", "/api/rows")[1]["rows"]


def lowest(candidates):
    return sorted(candidates, key=lambda r: (r["on_hand"], r["id"]))[:4]


def reno_fasteners(all_rows):
    return [r for r in all_rows if r["warehouse"] == "Reno" and r["category"] == "Fasteners"]


def edits(targets, value=250):
    return [{"id": r["id"], "field": "reorder", "value": value} for r in targets]


def save(changes, new_rows):
    return call("POST", "/api/save", {"changes": changes, "new_rows": new_rows})


def case(name, expect_pass, steps):
    call("POST", "/api/reset")
    all_rows = rows()
    steps(all_rows)
    result = call("GET", "/api/check")[1]
    ok = result["pass"] == expect_pass and (result["completed_at_ms"] is not None) == expect_pass
    print(f"{'ok  ' if ok else 'FAIL'} {name}: pass={result['pass']} matched={result['matched']}/{result['total']}")
    if not ok:
        failures.append(name)
    return result


def correct(all_rows):
    assert save(edits(lowest(reno_fasteners(all_rows))), [NEW_ROW])[0] == 200


def quick_filter_reno(all_rows):
    hits = [r for r in all_rows if r["category"] == "Fasteners" and "reno" in " ".join(str(r[k]) for k in ("sku", "item", "warehouse", "supplier")).lower()]
    save(edits(lowest(hits)), [NEW_ROW])


def twin_sku(all_rows):
    targets = lowest(reno_fasteners(all_rows))
    twin = next(r for r in all_rows if r["sku"] == targets[0]["sku"] and r["warehouse"] != "Reno")
    save(edits([twin] + targets[1:]), [NEW_ROW])


def never_saved_last_edit(all_rows):
    save(edits(lowest(reno_fasteners(all_rows))[:3]), [NEW_ROW])


def careless_units(all_rows):
    targets = lowest(reno_fasteners(all_rows))
    code, _ = save([{"id": r["id"], "field": "reorder", "value": "250 units"} for r in targets], [NEW_ROW])
    assert code == 422


def edited_existing_instead_of_adding(all_rows):
    boise = next(r for r in all_rows if r["sku"] == NEW_ROW["sku"] and r["warehouse"] == "Boise")
    save(edits(lowest(reno_fasteners(all_rows))) + [{"id": boise["id"], "field": "on_hand", "value": 600}], [])


def copied_boise_supplier(all_rows):
    boise = next(r for r in all_rows if r["sku"] == NEW_ROW["sku"] and r["warehouse"] == "Boise")
    save(edits(lowest(reno_fasteners(all_rows))), [dict(NEW_ROW, supplier=boise["supplier"])])


call("POST", "/api/reset")
targets = lowest(reno_fasteners(rows()))
fresh = case("fresh state fails", False, lambda _: None)
leak = json.dumps(fresh)
leaked = [v for v in [t["sku"] for t in targets] + [NEW_ROW["sku"], NEW_ROW["item"], NEW_ROW["supplier"], '"to": 250'] if v in leak]
print(f"{'ok  ' if not leaked else 'FAIL'} check leaks no answers{': ' + ', '.join(leaked) if leaked else ''}")
if leaked:
    failures.append("leak")
case("correct solution passes", True, correct)
case("trap: quick filter 'Reno' matches Renown Hardware", False, quick_filter_reno)
case("trap: same SKU edited in another warehouse", False, twin_sku)
case("trap: last edit never saved", False, never_saved_last_edit)
case("trap: '250 units' rejected by validation", False, careless_units)
case("trap: edited the Boise row instead of adding Reno", False, edited_existing_instead_of_adding)
case("trap: new row copied Boise's supplier", False, copied_boise_supplier)
case("trap: new row saved without its bin", False, lambda all_rows: save(edits(lowest(reno_fasteners(all_rows))), [dict(NEW_ROW, bin="")]))
case("reset restores state, correct run passes again", True, correct)
call("POST", "/api/reset")
sys.exit(1 if failures else 0)
