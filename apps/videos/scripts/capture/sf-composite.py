"""Finished frames for the Shared Folders film from a raw capture (.capture/<scene>, made by sf-cap.mjs), using
composite.py's window compositing (tint, page pictures, traffic lights).

usage: python3 sf-composite.py <scene>… → public/footage/<scene>/0000.jpg … and src/lib/sf-film/footage.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import composite as C

KEEP = ("label", "t", "ptr", "press", "step", "seen", "up", "typed", "head", "rows", "has")


def blank_page(path, cache={}):
    if path not in cache:
        import numpy as np
        from PIL import Image
        a = np.asarray(Image.open(path).convert("L").resize((96, 60)), np.float32)
        cache[path] = float(a.std()) < 4.0
    return cache[path]


def build(scene):
    src = os.path.join(C.ROOT, ".capture", scene)
    man = json.load(open(os.path.join(src, "manifest.json")))
    dst = os.path.join(C.ROOT, "public", "footage", scene)
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(dst):
        os.remove(os.path.join(dst, f))
    pages = man["pages"]
    frames = [fr for fr in man["frames"] if fr.get("ok") and os.path.exists(fr["f"])]
    last = {}
    out = []
    size = None
    for i, fr in enumerate(frames):
        keys = fr.get("pageKey") or {}
        items = []
        for tab in fr.get("tabs", []):
            cands = [pages.get(keys.get(tab, "")), pages.get(tab)] + [p for k, p in pages.items() if k.endswith(":" + tab)]
            pick = next((p for p in cands if p and not blank_page(os.path.join(src, p["file"]))), None) or last.get(tab)
            if pick:
                last[tab] = pick
                items.append((os.path.join(src, pick["file"]), pick["frame"]))
        img = C.composite(fr["f"], items, fr.get("color"), fr.get("dark", False))
        name = f"{len(out):04d}.jpg"
        img.save(os.path.join(dst, name), quality=93, subsampling=0)
        size = [img.width, img.height]
        out.append({k: fr[k] for k in KEEP if k in fr})
    extra = {k: v for k, v in man.items() if k not in ("frames", "pages", "urls")}
    if man.get("urls"):
        from PIL import Image
        shelf = os.path.join(C.ROOT, "public", "footage", "sf-pages")
        os.makedirs(shelf, exist_ok=True)
        for tab, url in man["urls"].items():
            p = pages.get(tab)
            if p and not blank_page(os.path.join(src, p["file"])):
                host = url.split("//")[-1].split("/")[0]
                Image.open(os.path.join(src, p["file"])).convert("RGB").save(os.path.join(shelf, host + ".jpg"), quality=90)
    for name in ("menu.json", "share-sheet.txt", "files.txt"):
        p = os.path.join(src, name)
        if os.path.exists(p):
            extra[name.split(".")[0].replace("-", "")] = json.load(open(p)) if name.endswith(".json") else open(p).read().strip().split("\n") if name == "files.txt" else open(p).read().strip()
    labels = [fr.get("label") for fr in frames]
    first = next((i for i, l in enumerate(labels) if l in ("arrive:before", "rest")), None)
    if first is not None and any(l in ("arrive", "adding") for l in labels):
        import numpy as np
        from PIL import Image
        a = np.asarray(Image.open(os.path.join(dst, f"{first:04d}.jpg")).convert("L"), np.float32)
        b = np.asarray(Image.open(os.path.join(dst, f"{len(out) - 1:04d}.jpg")).convert("L"), np.float32)
        band = np.abs(a[:96] - b[:96]) > 24
        cols = np.where(band.sum(axis=0) > 3)[0]
        if len(cols) > 20:
            x0 = int(cols.min())
            span = 240
            shifts = range(16, a.shape[1] - x0 - span)
            insert = min(shifts, key=lambda d: float(np.abs(a[:96, x0:x0 + span] - b[:96, x0 + d:x0 + d + span]).mean()))
            rgb = np.asarray(Image.open(os.path.join(dst, f"{first:04d}.jpg")).convert("RGB"), np.float32)
            fill = np.median(rgb[14:22, max(0, x0 - 10):max(1, x0 - 2)].reshape(-1, 3), axis=0)
            extra["strip"] = {"x": x0 / 2, "y": 2.0, "width": float(cols.max() - x0) / 2, "height": 40.0, "insert": insert / 2,
                              "fill": "#%02X%02X%02X" % tuple(int(round(v)) for v in fill)}
    tint = C.sampled_tint(frames[0]["f"]) if frames else None
    if tint is not None:
        extra["tint"] = ["#%02X%02X%02X" % tuple(int(round(v)) for v in c) for c in tint]
    index_path = os.path.join(C.ROOT, "src", "lib", "sf-film", "footage.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    index[scene] = {"size": size, "frames": out, **extra}
    json.dump(dict(sorted(index.items())), open(index_path, "w"), indent=1)
    print(f"{scene}: {len(out)} frames → {dst}")


if __name__ == "__main__":
    if len(sys.argv) < 2 or "--help" in sys.argv:
        print(__doc__)
        sys.exit(0)
    for s in sys.argv[1:]:
        build(s)
