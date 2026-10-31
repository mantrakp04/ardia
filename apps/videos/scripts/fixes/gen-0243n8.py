import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "fixes-0243n8.json")
PUBLIC = os.path.join(VIDEOS, "public")
KEYCAPS = {"⌘N"}
STILL_POINTER = {("stylesetting", "before")}


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
            events = [e for e in clip["events"] if "state" not in e and ("mark" not in e or e["mark"] in KEYCAPS)]
            if (seg["scene"], side) in STILL_POINTER:
                events = [e for e in events if "mark" in e]
            clip["events"] = events
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
