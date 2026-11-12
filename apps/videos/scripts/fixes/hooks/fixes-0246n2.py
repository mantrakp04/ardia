KEYCAPS = {"⇧⌘W", "⇧⌘T"}


def clip(seg, side, clip, video_id):
    clip["events"] = [e for e in clip["events"] if "mark" not in e or e["mark"] in KEYCAPS]
