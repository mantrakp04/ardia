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
SPEC = os.path.join(HERE, "fixes-0245n4.json")
PUBLIC = os.path.join(VIDEOS, "public")
ALERT = {"x": 460, "y": 40}
MARKERS = ("asked", "gone", "reopen")


def asked_dialog(scene, side):
    path = os.path.join(SCRATCH, "runs", f"{scene}-{side}", "dialog-asked.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def black_span(scene, side):
    mov = os.path.join(SCRATCH, "footage", side, f"{scene}.mov")
    run = subprocess.run(["ffmpeg", "-v", "info", "-i", mov, "-vf", "blackdetect=d=0.01:pix_th=0.05", "-an", "-f", "null", "-"], capture_output=True, text=True)
    spans = re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", run.stderr)
    if len(spans) != 1:
        raise SystemExit(f"{scene} {side}: expected one closed stretch, found {spans}")
    return float(spans[0][0]), float(spans[0][1])


def close_overlays(scene, clip, side):
    events = clip["events"]
    dialog = asked_dialog(scene, side)
    reopen = next(e["t"] for e in events if "reopen" in e)
    start, end = black_span(scene, side)
    if not start < reopen < end + 0.05:
        raise SystemExit(f"{scene} {side}: the window came back at {end}, the Dock reopen was at {reopen}")
    if side == "after":
        if dialog is not None:
            raise SystemExit(f"{scene} after: the build asked {dialog['title']!r}; the fix should ask nothing")
    else:
        if dialog is None or dialog.get("kind") != "confirm":
            raise SystemExit(f"{scene} before: no confirm was logged")
        asked = next(e["t"] for e in events if "asked" in e)
        press = next(e["t"] for e in events if "down" in e and e["t"] > asked)
        if not press < start:
            raise SystemExit(f"{scene} before: the window closed at {start}, before the press at {press}")
        clip["dialogs"] = [{
            "t": asked, "until": start, "press": press, **ALERT,
            "title": dialog["title"], "message": dialog["message"],
            "confirmTitle": dialog.get("confirmTitle", "OK"), "cancelTitle": dialog.get("cancelTitle", "Cancel"),
            "suppression": dialog.get("suppression"),
        }]
    clip["gone"] = {"t": start, "until": end, "reopen": reopen}


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
            if seg["scene"] == "n4close":
                close_overlays(seg["scene"], clip, side)
            clip["events"] = [e for e in clip["events"] if not any(m in e for m in MARKERS)]
            entry[side] = clip
        out.append(entry)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s -> {dest}")


if __name__ == "__main__":
    main()
