import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.normpath(os.path.join(HERE, "..", ".."))
SCRATCH = os.environ.get("FIXES_SCRATCH", os.path.expanduser("~/ardia-scratch/video-fixes"))


def side_clip(scene, side, lead, tail, public, video_id, sync="go"):
    src = os.path.join(SCRATCH, "footage", side)
    with open(os.path.join(src, f"{scene}.json")) as f:
        rec = json.load(f)
    go = next(e["t"] for e in rec["events"] if (e.get("mark") == "go" if sync == "go" else sync in e))
    in_s, out_s = round(go - lead, 3), round(go + tail, 3)
    if in_s < 0:
        raise SystemExit(f"{scene} {side}: lead {lead} s starts before the recording (go at {go})")
    dst = os.path.join(public, "footage", video_id, side)
    os.makedirs(dst, exist_ok=True)
    fps = os.environ.get("FIXES_CFR")
    if fps:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(src, f"{scene}.mov"), "-vf", f"fps={fps},tpad=stop_mode=clone:stop_duration=12", "-t", str(out_s + 1),
                        "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.join(dst, f"{scene}.mp4")], check=True)
    else:
        shutil.copyfile(os.path.join(src, f"{scene}.mov"), os.path.join(dst, f"{scene}.mov"))
    events = [{k: v for k, v in e.items() if k != "mark" or v != "go"} for e in rec["events"]]
    events = [e for e in events if len(e) > 1]
    overlays = []
    for e in [e for e in events if "overlay" in e]:
        o = e["overlay"]
        name = f"{scene}-{o['file']}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(src, f"{o['file']}.mov"), "-vf", "fps=60,tpad=stop_mode=clone:stop_duration=12", "-t", str(max(1, out_s - e["t"] + 1)),
                        "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.join(dst, f"{name}.mp4")], check=True)
        overlays.append({"file": f"footage/{video_id}/{side}/{name}.mp4", "t": e["t"], "x": o["rect"][0] - rec["rect"][0], "y": o["rect"][1] - rec["rect"][1], "w": o["rect"][2], "h": o["rect"][3]})
    events = [e for e in events if "overlay" not in e]
    clip = {"file": f"footage/{video_id}/{side}/{scene}.{'mp4' if os.environ.get('FIXES_CFR') else 'mov'}", "inS": in_s, "outS": out_s, "events": events}
    if "scale" in rec:
        clip.update(w=round(rec["rect"][2] * rec["scale"]), h=round(rec["rect"][3] * rec["scale"]), scale=rec["scale"])
    if overlays:
        clip["overlays"] = overlays
    return clip


def main():
    spec_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "fixes-0241.json")
    public = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SCRATCH, "public")
    with open(spec_path) as f:
        spec = json.load(f)
    video_id = spec["id"]
    out = []
    for seg in spec["segments"]:
        scene = seg["scene"]
        sides = ["after"] if seg.get("afterOnly") else ["before", "after"]
        clips = {side: side_clip(scene, side, seg["lead"], seg["tail"], public, video_id, seg.get("sync", "go")) for side in sides}
        entry = {k: v for k, v in seg.items() if k not in ("lead", "tail", "sync")}
        entry["length"] = round(seg["lead"] + seg["tail"], 3)
        entry.update(clips)
        out.append(entry)
    for name in ("brand", "fonts"):
        target = os.path.join(public, name)
        if not os.path.exists(target):
            shutil.copytree(os.path.join(VIDEOS, "public", name), target)
    dest = os.path.join(VIDEOS, "src", "videos", video_id, "segments.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{len(out)} segments, {sum(s['length'] for s in out):.1f} s of footage -> {dest}; public dir {public}")


if __name__ == "__main__":
    main()
