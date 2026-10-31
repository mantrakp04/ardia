import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import segments as seg_lib

VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SCRATCH = seg_lib.SCRATCH
SPEC = os.path.join(HERE, "fixes-0243n5.json")
PUBLIC = os.path.join(VIDEOS, "public")
ALERT_TOP = 40


def asked_dialog(scene, side):
    path = os.path.join(SCRATCH, "runs", f"{scene}-{side}", "dialog-asked.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def first_black(scene, side):
    mov = os.path.join(SCRATCH, "footage", side, f"{scene}.mov")
    run = subprocess.run(["ffmpeg", "-v", "info", "-i", mov, "-vf", "blackdetect=d=0.01:pix_th=0.05", "-an", "-f", "null", "-"], capture_output=True, text=True)
    starts = [float(m) for m in re.findall(r"black_start:([\d.]+)", run.stderr)]
    return starts[0] if starts else None


def close_window_overlays(scene, clip, side):
    dialog = asked_dialog(scene, side)
    events = clip["events"]
    if side == "after":
        if dialog is not None:
            raise SystemExit(f"{scene} after: the build asked {dialog['title']!r}; the fix should ask nothing")
        if any("gone" in e for e in events):
            raise SystemExit(f"{scene} after: the window closed")
        return
    if dialog is None or dialog.get("kind") != "confirm":
        raise SystemExit(f"{scene} before: no confirm was logged")
    asked = next(e["t"] for e in events if "asked" in e)
    gone_event = next(e for e in events if "gone" in e)
    if gone_event["gone"] != 1:
        raise SystemExit(f"{scene} before: the window didn't close after Close Tab")
    downs = [e["t"] for e in events if "down" in e]
    press = next(t for t in downs if t > asked)
    black = first_black(scene, side)
    if black is None or black < press:
        raise SystemExit(f"{scene} before: the footage never lost the window after the press (black at {black})")
    clip["dialogs"] = [{
        "t": asked, "until": black, "press": press, "x": 680, "y": ALERT_TOP,
        "title": dialog["title"], "message": dialog["message"],
        "confirmTitle": dialog.get("confirmTitle", "OK"), "cancelTitle": dialog.get("cancelTitle", "Cancel"),
        "suppression": dialog.get("suppression"),
    }]
    clip["gone"] = {"t": black, "text": "The window closed"}
    clip["events"] = [e for e in events if "asked" not in e and "gone" not in e]


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
            entry[side] = seg_lib.side_clip(seg["scene"], side, seg["lead"], seg["tail"], PUBLIC, video_id, seg.get("sync", "go"))
            if seg["scene"] == "lasttab":
                close_window_overlays(seg["scene"], entry[side], side)
            else:
                entry[side]["events"] = [e for e in entry[side]["events"] if "asked" not in e and "gone" not in e]
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
