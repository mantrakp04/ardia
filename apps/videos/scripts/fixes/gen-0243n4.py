import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SCRATCH = seg_lib.SCRATCH
SPEC = os.path.join(HERE, "fixes-0243n4.json")
PUBLIC = os.path.join(VIDEOS, "public")

FOLDER_MENU_BEFORE = [
    ("The Daily Ledger", "globe"),
    ("moodwall — ideas for everything", "globe"),
    ("Crumbs — Brown butter oat cookies", "globe"),
    ("Trip plan — Docpad", "globe"),
    None,
    ("Open All in New Tabs", "plus.app"),
    ("Open All in New Window", "macwindow.badge.plus"),
    ("Open All in Incognito Window", "eyeglasses"),
    ("Add to Sidebar as Group", "sidebar.left"),
]


def logged_titles(scene, side):
    path = os.path.join(SCRATCH, "runs", f"{scene}-{side}", "activation.log")
    with open(path) as f:
        lines = [l for l in f if "pop-up menu (not shown):" in l]
    if len(lines) != 1:
        raise SystemExit(f"{scene} {side}: expected one logged menu, found {len(lines)}")
    return [t.strip() for t in lines[0].split("(not shown):", 1)[1].split("|")]


def pointer_before(events, t):
    at = None
    for e in events:
        if e["t"] > t:
            break
        if "x" in e:
            at = e
    return at


def before_menu(scene, clip, rule):
    got = logged_titles(scene, "before")
    want = [r[0] for r in FOLDER_MENU_BEFORE if r]
    if got != want:
        raise SystemExit(f"{scene}: logged {got} != drawn {want}")
    events = clip["events"]
    start = next(e["t"] for e in events if rule["from"] in e and e["t"] >= clip["inS"])
    until = next(e["t"] for e in events if rule["until"] in e)
    p = pointer_before(events, start)
    items = [{"sep": True} if r is None else {"title": r[0], "symbol": r[1]} for r in FOLDER_MENU_BEFORE]
    return {"t": start, "until": until, "x": p["x"], "y": p["y"], "items": items}


def still_clip(video_id, seg, side):
    st = seg["still"]
    dst = os.path.join(PUBLIC, "footage", video_id, side)
    os.makedirs(dst, exist_ok=True)
    shutil.copyfile(os.path.join(SCRATCH, "stills", st[side]), os.path.join(dst, st[side]))
    return {"still": f"footage/{video_id}/{side}/{st[side]}", "w": st["w"], "h": st["h"], "scale": 1, "inS": 0, "outS": seg["length"], "events": []}


def main():
    with open(SPEC) as f:
        spec = json.load(f)
    video_id = spec["id"]
    out = []
    for seg in spec["segments"]:
        entry = {k: v for k, v in seg.items() if k not in ("lead", "tail", "sync", "still", "beforeMenu")}
        if "still" in seg:
            for side in ("before", "after"):
                entry[side] = still_clip(video_id, seg, side)
        else:
            entry["length"] = round(seg["lead"] + seg["tail"], 3)
            for side in ("before", "after"):
                entry[side] = seg_lib.side_clip(seg["scene"], side, seg["lead"], seg["tail"], PUBLIC, video_id, seg.get("sync", "go"))
            if "beforeMenu" in seg:
                entry["before"]["menus"] = [before_menu(seg["scene"], entry["before"], seg["beforeMenu"])]
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
