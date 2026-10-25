import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SCRATCH = os.environ.get("FIXES_SCRATCH", os.path.expanduser("~/ardia-scratch/video-fixes"))


def side_clip(scene, side, lead, tail, public, video_id):
    src = os.path.join(SCRATCH, "footage", side)
    with open(os.path.join(src, f"{scene}.json")) as f:
        rec = json.load(f)
    go = next(e["t"] for e in rec["events"] if e.get("mark") == "go")
    in_s, out_s = round(go - lead, 3), round(go + tail, 3)
    if in_s < 0:
        raise SystemExit(f"{scene} {side}: lead {lead} s starts before the recording (go at {go})")
    dst = os.path.join(public, "footage", video_id, side)
    os.makedirs(dst, exist_ok=True)
    shutil.copyfile(os.path.join(src, f"{scene}.mov"), os.path.join(dst, f"{scene}.mov"))
    events = [{k: v for k, v in e.items() if k != "mark" or v != "go"} for e in rec["events"]]
    events = [e for e in events if len(e) > 1]
    return {"file": f"footage/{video_id}/{side}/{scene}.mov", "inS": in_s, "outS": out_s, "events": events}


def main():
    spec_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "fixes-0241.json")
    public = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SCRATCH, "public")
    with open(spec_path) as f:
        spec = json.load(f)
    video_id = spec["id"]
    out = []
    for seg in spec["segments"]:
        scene = seg["scene"]
        sides = ["after"] if seg.get("afterOnly") else ["before", "after"]
        clips = {side: side_clip(scene, side, seg["lead"], seg["tail"], public, video_id) for side in sides}
        entry = {k: v for k, v in seg.items() if k not in ("lead", "tail")}
        entry["length"] = round(seg["lead"] + seg["tail"], 3)
        entry.update(clips)
        out.append(entry)
    for name in ("brand", "fonts"):
        target = os.path.join(public, name)
        if not os.path.exists(target):
            shutil.copytree(os.path.join(VIDEOS, "public", name), target)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s of footage -> {dest}; public dir {public}")


if __name__ == "__main__":
    main()
