import json
import os

import segments as seg_lib

SPEC_ONLY = ("gaps",)
GAP_NOTE_AFTER_GO = 2.0


def gap_note(scene, side, text):
    with open(os.path.join(seg_lib.SCRATCH, "footage", side, f"{scene}.json")) as f:
        rec = json.load(f)
    go = next(e["t"] for e in rec["events"] if e.get("mark") == "go")
    last = rec["prepared"]["last"]
    return {"t": round(go + GAP_NOTE_AFTER_GO, 3), "x": last["x"], "y": last["y"] + last["height"] + 4, "text": text}


def banners(events):
    return [{"t": e["t"], "title": e["title"], "body": e["body"], "subtitle": e["subtitle"], "silent": e["silent"]} for e in events if e.get("notify")]


def clip(seg, side, clip, video_id):
    found = banners(clip["events"])
    if found:
        clip["banners"] = found
    if "gaps" in seg:
        clip["notes"] = [gap_note(seg["scene"], side, seg["gaps"][side])]
