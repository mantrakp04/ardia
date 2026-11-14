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


def clip(seg, side, clip, video_id):
    if seg["scene"] == "playerhover":
        caption_player(clip)
    else:
        clip["events"] = [e for e in clip["events"] if "mark" not in e]
