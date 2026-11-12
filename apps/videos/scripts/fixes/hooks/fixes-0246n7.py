import json
import os
import subprocess

import segments as seg_lib

STILLS = os.path.expanduser("~/ardia-scratch/stills/film-ui")
PIP = os.path.expanduser("~/ardia-scratch/videos/report-recording-pip-before-after.mp4")
GO = 0.5
LENGTH = 7


def footage(scene, side, args, w, h, scale):
    dst = os.path.join(seg_lib.SCRATCH, "footage", side)
    os.makedirs(dst, exist_ok=True)
    mov = os.path.join(dst, f"{scene}.mov")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-r", "60", "-t", str(LENGTH), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", mov], check=True)
    with open(os.path.join(dst, f"{scene}.json"), "w") as f:
        json.dump({"events": [{"t": GO, "mark": "go"}], "rect": [0, 0, w, h], "scale": scale}, f)


def checknow(side):
    still = os.path.join(STILLS, f"5-{side}-window.png")
    footage("n7checknow", side, ["-loop", "1", "-i", still], 820, 640, 2)


def pip(side):
    x = 0 if side == "before" else 960
    footage("n7pip", side, ["-i", PIP, "-vf", f"crop=960:606:{x}:606,tpad=stop_mode=clone:stop_duration=4"], 960, 606, 1)


for side in ("before", "after"):
    checknow(side)
    pip(side)


def import_window(clip):
    end = next((e["t"] for e in clip["events"] if "overlayEnd" in e), None)
    overlay = (clip.get("overlays") or [None])[0]
    if overlay and end is not None:
        overlay["until"] = end
    dx, dy = (overlay["x"], overlay["y"]) if overlay else (0, 0)
    clip["events"] = [({**e, "x": e["x"] + dx, "y": e["y"] + dy} if "x" in e else e) for e in clip["events"] if "overlayEnd" not in e]


def clip(seg, side, clip, video_id):
    if seg["scene"] == "n7zen":
        import_window(clip)
    if seg["scene"] in ("n7zen", "n7onboard"):
        clip["events"] = [e for e in clip["events"] if "mark" not in e]
