import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
SCRATCH = os.environ.get("FIXES_SCRATCH", os.path.expanduser("~/ardia-scratch/video-fixes"))
SOURCE = os.environ.get("N6_SOURCE", os.path.expanduser("~/ardia-scratch/videos"))
STILLS = os.environ.get("N6_STILLS", os.path.expanduser("~/ardia-scratch/film-0246n6"))
LIGHTS = {"left": (16, 28, 160, 68), "right": (2218, 16, 156, 66)}
SPEC_ONLY = ("reuse", "lights")


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height:format=duration", "-of", "json", path], capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    return info["streams"][0]["width"], info["streams"][0]["height"], float(info["format"]["duration"])


def restore_lights(scene, side_of_sidebar):
    x, y, w, h = LIGHTS[side_of_sidebar]
    still = os.path.join(STILLS, f"stills-{side_of_sidebar}.png")
    for side in ("before", "after"):
        mov = os.path.join(SCRATCH, "footage", side, f"{scene}.mov")
        raw = os.path.join(SCRATCH, "footage", side, f"{scene}.unpatched.mov")
        stamp = mov + ".patched"
        patched_at = open(stamp).read() if os.path.exists(stamp) else ""
        if not os.path.exists(raw) or patched_at != str(os.path.getmtime(mov)):
            os.replace(mov, raw)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-i", still, "-filter_complex", f"[1:v]crop={w}:{h}:{x}:{y}[p];[0:v][p]overlay={x}:{y}", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", mov], check=True)
        with open(stamp, "w") as f:
            f.write(str(os.path.getmtime(mov)))


def stage_reused():
    with open(os.path.join(HERE, "..", "fixes-0246n6.json")) as f:
        spec = json.load(f)
    for seg in spec["segments"]:
        if seg.get("lights"):
            restore_lights(seg["scene"], seg["lights"])
        reuse = seg.get("reuse")
        if not reuse:
            continue
        for side in ("before", "after"):
            cut = reuse[side]
            dst = os.path.join(SCRATCH, "footage", side)
            os.makedirs(dst, exist_ok=True)
            graph = "".join(f"[0:v]trim={a}:{b},setpts=(PTS-STARTPTS)/{speed},crop={reuse['crop'] if 'crop' not in cut else cut['crop']},fps=60,setsar=1[p{i}];" for i, (a, b, speed) in enumerate(cut["parts"]))
            labels = "".join(f"[p{i}]" for i in range(len(cut["parts"])))
            mov = os.path.join(dst, f"{seg['scene']}.mov")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(SOURCE, reuse["src"]), "-filter_complex", f"{graph}{labels}concat=n={len(cut['parts'])}:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-an", mov], check=True)
            w, h, _ = probe(mov)
            scale = reuse.get("scale", 1)
            with open(os.path.join(dst, f"{seg['scene']}.json"), "w") as f:
                json.dump({"events": [{"t": 0, "mark": "go"}], "rect": [0, 0, round(w / scale), round(h / scale)], "scale": scale}, f)


stage_reused()


def clip(seg, side, clip, video_id):
    if seg.get("reuse"):
        clip["events"] = []
