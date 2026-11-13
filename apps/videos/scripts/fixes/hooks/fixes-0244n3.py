import json
import os
import subprocess

import segments as seg_lib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(os.path.dirname(os.path.dirname(HERE)), "public")


def menu_items(scene, side):
    with open(os.path.join(seg_lib.SCRATCH, "runs", f"{scene}-{side}", "menu.json")) as f:
        items = json.load(f)
    keep = ("title", "symbol", "checked", "separator")
    trim = lambda item: {**{k: item[k] for k in keep if item.get(k)}, **({"children": [trim(c) for c in item["children"]]} if item.get("children") else {})}
    return [trim(i) for i in items]


def symbols(items, video_id):
    names = sorted({i["symbol"] for i in items if i.get("symbol")})
    if names:
        subprocess.run(["swift", os.path.join(HERE, "symbols.swift"), os.path.join(PUBLIC, "footage", video_id, "symbols"), *names], check=True)


def menus(scene, side, events, video_id):
    opened = [e for e in events if e.get("menu") == "open"]
    if not opened:
        return None
    items = menu_items(scene, side)
    symbols(items, video_id)
    out = []
    for o in opened:
        close = next(e["t"] for e in events if e.get("menu") == "close" and e["t"] >= o["t"])
        sub = next((e["t"] for e in events if e.get("submenu") == "open" and o["t"] <= e["t"] <= close), None)
        out.append({"t": o["t"], "until": close, "sub": sub, "geometry": o["geometry"], "items": items})
    return out


def clip(seg, side, clip, video_id):
    found = menus(seg["scene"], side, clip["events"], video_id)
    if found:
        clip["menus"] = found
