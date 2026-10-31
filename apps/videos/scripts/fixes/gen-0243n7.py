import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "fixes-0243n7.json")
PUBLIC = os.path.join(VIDEOS, "public")
CAPTIONS = {"rest": "Rest on the player", "play2": "Click play"}


def caption_player(clip):
    events = []
    first_down = next(e["t"] for e in clip["events"] if "down" in e)
    events.append({"t": first_down, "mark": "Click pause"})
    for e in clip["events"]:
        if "mark" not in e:
            events.append(e)
        elif e["mark"] in CAPTIONS:
            events.append({"t": e["t"], "mark": CAPTIONS[e["mark"]]})
    clip["events"] = sorted(events, key=lambda e: e["t"])


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
            if seg["scene"] == "playerhover":
                caption_player(clip)
            else:
                clip["events"] = [e for e in clip["events"] if "mark" not in e]
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
