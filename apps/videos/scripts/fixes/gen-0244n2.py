import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "fixes-0244n2.json")
PUBLIC = os.path.join(VIDEOS, "public")
GAP_NOTE_AFTER_GO = 2.0


def gap_note(scene, side, text):
    with open(os.path.join(seg_lib.SCRATCH, "footage", side, f"{scene}.json")) as f:
        rec = json.load(f)
    go = next(e["t"] for e in rec["events"] if e.get("mark") == "go")
    last = rec["prepared"]["last"]
    return {"t": round(go + GAP_NOTE_AFTER_GO, 3), "x": last["x"], "y": last["y"] + last["height"] + 4, "text": text}


def banners(events):
    return [{"t": e["t"], "title": e["title"], "body": e["body"], "subtitle": e["subtitle"], "silent": e["silent"]} for e in events if e.get("notify")]


def main():
    os.environ.setdefault("FIXES_CFR", "60")
    with open(SPEC) as f:
        spec = json.load(f)
    video_id = spec["id"]
    out = []
    for seg in spec["segments"]:
        entry = {k: v for k, v in seg.items() if k not in ("lead", "tail", "sync", "gaps")}
        entry["length"] = round(seg["lead"] + seg["tail"], 3)
        for side in ("before", "after"):
            clip = seg_lib.side_clip(seg["scene"], side, seg["lead"], seg["tail"], PUBLIC, video_id, seg.get("sync", "go"))
            found = banners(clip["events"])
            if found:
                clip["banners"] = found
            clip["events"] = [e for e in clip["events"] if "state" not in e and "mark" not in e and "notify" not in e]
            if "gaps" in seg:
                clip["notes"] = [gap_note(seg["scene"], side, seg["gaps"][side])]
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
