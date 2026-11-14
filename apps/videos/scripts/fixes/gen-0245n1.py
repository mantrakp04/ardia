import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SPEC = os.path.join(HERE, "fixes-0245n1.json")
PUBLIC = os.path.join(VIDEOS, "public")


def size_of(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    w, h = out.strip().split(",")[:2]
    return int(w), int(h)


def main():
    with open(SPEC) as f:
        spec = json.load(f)
    out = []
    for seg in spec["segments"]:
        entry = {k: v for k, v in seg.items() if k != "in"}
        for side in ("before", "after"):
            file = f"{spec['footage']}/{side}/{seg['scene']}.mp4"
            w, h = size_of(os.path.join(PUBLIC, file))
            in_s = seg["in"][side]
            entry[side] = {"file": file, "w": w, "h": h, "scale": 1, "inS": in_s, "outS": round(in_s + seg["length"], 3), "events": []}
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", spec["id"], "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] / s.get('rate', 1) for s in out):.1f} s of play -> {dest}")


if __name__ == "__main__":
    main()
