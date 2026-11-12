import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "release-0244.json")
PUBLIC = os.path.join(VIDEOS, "public")
VIDEO_ID = "release-0244"
DEST = os.path.join(PUBLIC, "footage", VIDEO_ID)
SCRATCH = seg_lib.SCRATCH


def menu_items(raw):
    out = []
    for item in raw or []:
        if not item.get("visible", True):
            continue
        title = item.get("title", item.get("label", ""))
        if item.get("separator") or item.get("type") == 4 or title == "":
            out.append({"separator": True})
            continue
        entry = {"title": title}
        if item.get("symbol"):
            entry["symbol"] = item["symbol"]
        if item.get("checked") or item.get("state") == "on":
            entry["checked"] = True
        if item.get("enabled") is False:
            entry["disabled"] = True
        kids = item.get("children") or item.get("submenu")
        if kids:
            entry["children"] = menu_items(kids)
        out.append(entry)
    return out


def symbols_of(items):
    for item in items:
        if item.get("symbol"):
            yield item["symbol"]
        yield from symbols_of(item.get("children", []))


def build_menus(clip, rec):
    raw = (rec.get("prepared") or {}).get("menu") or (rec.get("prepared") or {}).get("items") or []
    items = menu_items(raw)
    menus = []
    current = None
    for e in clip["events"]:
        if e.get("menu") == "open":
            current = {"t": e["t"], "until": e["t"] + 30, "sub": None, "geometry": e["geometry"], "items": json.loads(json.dumps(items))}
            if e.get("open", -1) >= 0:
                current["items"][e["open"]]["open"] = True
            menus.append(current)
        elif e.get("menu") == "sub" and current:
            current["sub"] = e["t"]
        elif e.get("menu") == "close" and current:
            current["until"] = e["t"]
            current = None
    clip["events"] = [e for e in clip["events"] if "menu" not in e]
    if menus:
        clip["menus"] = menus
    return set(symbols_of(items))


def build_terminal(clip, pane):
    lines = [{"t": e["t"], "text": e["term"], "dim": bool(e.get("dim"))} for e in clip["events"] if "term" in e]
    clip["events"] = [e for e in clip["events"] if "term" not in e]
    if lines:
        clip["panes"] = [{"t": clip["inS"], "style": "terminal", "lines": lines, **pane}]


def build_editor(clip, pane, initial):
    saves = [e for e in clip["events"] if "save" in e]
    clip["events"] = [{k: v for k, v in e.items() if k not in ("save", "mark")} for e in clip["events"]]
    clip["events"] = [e for e in clip["events"] if len(e) > 1]
    panes = []
    start = clip["inS"]
    texts = [initial] + [s["save"] for s in saves]
    times = [start] + [s["t"] for s in saves]
    for i, text in enumerate(texts):
        until = times[i + 1] if i + 1 < len(times) else None
        entry = {"t": times[i], "style": "editor", "lines": [{"t": times[i], "text": line} for line in text.split("\n")], **pane}
        if until is not None:
            entry["until"] = until
        if i > 0:
            entry["saved"] = times[i]
        panes.append(entry)
    clip["panes"] = panes


def build_static_pane(clip, pane, text):
    clip["panes"] = [{"t": clip["inS"], "style": pane.get("style", "editor"), "lines": [{"t": clip["inS"], "text": line} for line in text.split("\n")], **{k: v for k, v in pane.items() if k != "style"}}]


def notes_for(scene, side, clip, rec):
    notes = []
    if scene == "ubo":
        notes.append({"t": clip["inS"] + 4.6, "x": 140, "y": 600, "text": "uBlock Origin 1.75.4" if side == "after" else "uBlock Origin 1.75.0"})
    if scene == "sharefolder" and side == "after":
        close = next((m["until"] for m in clip.get("menus", [])), None)
        if close is not None:
            notes.append({"t": close + 0.5, "x": 10, "y": 300, "text": "Share sheet opens (logged: hidden instance)"})
    if scene == "pageshare" and side == "after":
        close = next((m["until"] for m in clip.get("menus", [])), None)
        if close is not None:
            notes.append({"t": close + 0.4, "x": 280, "y": 470, "text": "Shared: http://crumbs.example/, no utm tags"})
    if notes:
        clip["notes"] = clip.get("notes", []) + notes


def new_clip(seg, side):
    scene = seg["scene"]
    clip = seg_lib.side_clip(scene, side, seg["lead"], seg["tail"], PUBLIC, VIDEO_ID, seg.get("sync", "go"))
    with open(os.path.join(SCRATCH, "footage", side, f"{scene}.json")) as f:
        rec = json.load(f)
    symbols = build_menus(clip, rec)
    if seg.get("terminal"):
        build_terminal(clip, seg["terminal"])
    if seg.get("editor"):
        build_editor(clip, seg["editor"], seg["editor_initial"])
    if seg.get("static_pane"):
        build_static_pane(clip, seg["static_pane"], seg["static_text"])
    notes_for(scene, side, clip, rec)
    return clip, symbols


def reused(seg):
    with open(os.path.join(VIDEOS, "src", "videos", seg["from"], "segments.json")) as f:
        source = next(s for s in json.load(f) if s["scene"] == seg["source_scene"])
    entry = {k: v for k, v in source.items() if k not in ("title", "body")}
    for side in ("before", "after"):
        clip = entry.get(side)
        if not clip:
            continue
        name = f"{seg['scene']}{os.path.splitext(clip['file'])[1]}"
        src = os.path.join(PUBLIC, clip["file"])
        dst = os.path.join(DEST, side, name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        clip["file"] = f"footage/{VIDEO_ID}/{side}/{name}"
        for menu in clip.get("menus", []):
            for item in menu["items"]:
                if item.get("children"):
                    item["open"] = True
                    break
    return entry


def still(seg):
    entry = {"cam": seg["cam"], "length": seg["length"]}
    for side in ("before", "after"):
        name = f"{seg['scene']}.png"
        dst = os.path.join(DEST, side, name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(PUBLIC, seg["still_from"], side, seg["still_name"]), dst)
        entry[side] = {"still": f"footage/{VIDEO_ID}/{side}/{name}", "w": seg["still_size"][0], "h": seg["still_size"][1], "scale": 1, "inS": 0, "outS": seg["length"], "events": []}
    return entry


KEEP = ("scene", "title", "body", "section", "card", "layout", "cam", "zoom", "rate", "note", "cursor", "afterOnly", "beforeVersion", "afterVersion", "kind", "reason")


def main():
    with open(SPEC) as f:
        spec = json.load(f)
    os.makedirs(os.path.join(DEST, "symbols"), exist_ok=True)
    for name in os.listdir(os.path.join(PUBLIC, "footage", "fixes-0244n3", "symbols")):
        shutil.copyfile(os.path.join(PUBLIC, "footage", "fixes-0244n3", "symbols", name), os.path.join(DEST, "symbols", name))
    out = []
    symbols = set()
    for seg in spec["segments"]:
        kind = seg.get("source", "new")
        if kind == "text":
            entry = {"kind": "text", "cam": [0, 0, 1, 1], "length": seg["length"]}
        elif kind == "reuse":
            entry = reused(seg)
        elif kind == "still":
            entry = still(seg)
        else:
            entry = {"cam": seg["cam"], "length": round(seg["lead"] + seg["tail"], 3)}
            for side in seg.get("sides", ["before", "after"]):
                clip, syms = new_clip(seg, side)
                entry[side] = clip
                symbols |= syms
        entry.update({k: seg[k] for k in KEEP if k in seg})
        out.append(entry)
    missing = [s for s in sorted(symbols) if not os.path.exists(os.path.join(DEST, "symbols", f"{s}.png"))]
    if missing:
        subprocess.run(["swift", os.path.join(HERE, "symbols.swift"), os.path.join(DEST, "symbols"), *missing], check=True)
    dest = os.path.join(VIDEOS, "src", "videos", VIDEO_ID, "segments.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s of shots -> {dest}")


if __name__ == "__main__":
    main()
