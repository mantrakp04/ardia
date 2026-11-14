KEYCAPS = {"⌘N"}
STILL_POINTER = {("stylesetting", "before")}


def clip(seg, side, clip, video_id):
    events = [e for e in clip["events"] if "state" not in e and ("mark" not in e or e["mark"] in KEYCAPS)]
    if (seg["scene"], side) in STILL_POINTER:
        events = [e for e in events if "mark" in e]
    clip["events"] = events
