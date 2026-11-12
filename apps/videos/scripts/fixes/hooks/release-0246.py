import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", ".."))
SCRATCH = os.environ.get("FIXES_SCRATCH", os.path.expanduser("~/ardia-scratch/film-0246"))
FILMS = os.path.join(REPO, "apps", "site", "public", "release-videos")
SPEC_ONLY = ("reuse",)


def stage_reused():
    with open(os.path.join(HERE, "..", "release-0246.json")) as f:
        spec = json.load(f)
    for seg in spec["segments"]:
        reuse = seg.get("reuse")
        if not reuse:
            continue
        for side in ("before", "after"):
            x, y, w, h, start, end = reuse[side]
            dst = os.path.join(SCRATCH, "footage", side)
            os.makedirs(dst, exist_ok=True)
            mov = os.path.join(dst, f"{seg['scene']}.mov")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-to", str(end), "-i", os.path.join(FILMS, reuse["film"]), "-vf", f"crop={w}:{h}:{x}:{y},fps=60,setsar=1", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-an", mov], check=True)
            with open(os.path.join(dst, f"{seg['scene']}.json"), "w") as f:
                json.dump({"events": [{"t": 0, "mark": "go"}], "rect": [0, 0, w, h], "scale": 1}, f)


def clip(seg, side, clip, video_id):
    return clip


stage_reused()
