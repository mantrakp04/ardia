import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "fixes-0244n3.json")
PUBLIC = os.path.join(VIDEOS, "public")


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


def main():
    os.environ.setdefault("FIXES_CFR", "60")
    with open(SPEC) as f:
        spec = json.load(f)
    video_id = spec["id"]
    out = []
    for seg in spec["segments"]:
        entry = {k: v for k, v in seg.items() if k not in ("lead", "tail", "sync")}
        entry["length"] = round(seg["lead"] + seg["tail"], 3)
        for side in ("before", "after"):
            clip = seg_lib.side_clip(seg["scene"], side, seg["lead"], seg["tail"], PUBLIC, video_id, seg.get("sync", "go"))
            found = menus(seg["scene"], side, clip["events"], video_id)
            if found:
                clip["menus"] = found
            clip["events"] = [e for e in clip["events"] if "menu" not in e and "submenu" not in e]
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
