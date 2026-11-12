"""Usage: gen.py <id>

Writes src/videos/<id>/segments.json from scripts/fixes/<id>.json and the captures in $FIXES_SCRATCH.
The spec's "dropEvents" lists event keys left out of every clip; scripts/fixes/hooks/<id>.py, when it
exists, finishes each clip with clip(seg, side, clip, video_id) and names spec-only keys in SPEC_ONLY."""

import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(VIDEOS, "public")
SPEC_KEYS = ("lead", "tail", "sync")


def load_hooks(video_id):
    path = os.path.join(HERE, "hooks", f"{video_id}.py")
    if not os.path.exists(path):
        return None
    spec = importlib.util.spec_from_file_location(f"hooks_{video_id.replace('-', '_')}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
        raise SystemExit(__doc__)
    video_id = sys.argv[1]
    os.environ.setdefault("FIXES_CFR", "60")
    with open(os.path.join(HERE, f"{video_id}.json")) as f:
        spec = json.load(f)
    if spec["id"] != video_id:
        raise SystemExit(f"{video_id}.json is for {spec['id']}")
    hooks = load_hooks(video_id)
    spec_only = SPEC_KEYS + tuple(getattr(hooks, "SPEC_ONLY", ()))
    dropped = tuple(spec.get("dropEvents", ()))
    out = []
    for seg in spec["segments"]:
        entry = {k: v for k, v in seg.items() if k not in spec_only}
        entry["length"] = round(seg["lead"] + seg["tail"], 3)
        for side in ("before", "after"):
            clip = seg_lib.side_clip(seg["scene"], side, seg["lead"], seg["tail"], PUBLIC, video_id, seg.get("sync", "go"))
            if hooks:
                hooks.clip(seg, side, clip, video_id)
            clip["events"] = [e for e in clip["events"] if not any(k in e for k in dropped)]
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
