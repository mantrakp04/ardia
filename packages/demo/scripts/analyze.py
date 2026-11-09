import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SCALE = 2

REGIONS = {
    "lights": {"box": (10, 13, 76, 28), "states": ["idle", "profile"], "text": False},
    "chrome": {"box": (80, 0, 110, 56), "states": ["idle", "command", "ntp", "hover", "profile", "field"]},
    "sidebar": {"box": (0, 0, 190, 868), "states": ["idle", "command", "ntp", "hover", "profile", "field"]},
    "tabrows": {"box": (0, 125, 190, 280), "states": ["idle", "hover", "ntp", "profile", "field"]},
    "field": {"box": (0, 40, 190, 90), "states": ["field"]},
    "toolbar": {"box": (190, 0, 1218, 47), "states": ["idle", "ntp", "hover", "profile"]},
    "command": {"box": (190, 0, 1218, 300), "states": ["command"]},
    "ntp": {"box": (190, 47, 1218, 821), "states": ["ntp"]},
    "menus": {"box": (0, 0, 1408, 868), "states": ["menu"]},
}


def srgb_to_lab(rgb):
    c = np.clip(np.asarray(rgb, dtype=np.float64), 0, 255) / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def delta_e2000(lab1, lab2):
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cm = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cm**7 / (Cm**7 + 25**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dhp = h2p - h1p
    dhp = np.where(dhp > 180, dhp - 360, np.where(dhp < -180, dhp + 360, dhp))
    dhp = np.where(C1p * C2p == 0, 0, dhp)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp / 2))
    Lpm, Cpm = (L1 + L2) / 2, (C1p + C2p) / 2
    hsum = h1p + h2p
    hpm = np.where(C1p * C2p == 0, hsum, np.where(np.abs(h1p - h2p) <= 180, hsum / 2, np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2)))
    T = 1 - 0.17 * np.cos(np.radians(hpm - 30)) + 0.24 * np.cos(np.radians(2 * hpm)) + 0.32 * np.cos(np.radians(3 * hpm + 6)) - 0.20 * np.cos(np.radians(4 * hpm - 63))
    dtheta = 30 * np.exp(-(((hpm - 275) / 25) ** 2))
    RC = 2 * np.sqrt(Cpm**7 / (Cpm**7 + 25**7))
    SL = 1 + 0.015 * (Lpm - 50) ** 2 / np.sqrt(20 + (Lpm - 50) ** 2)
    SC, SH = 1 + 0.045 * Cpm, 1 + 0.015 * Cpm * T
    RT = -np.sin(np.radians(2 * dtheta)) * RC
    return np.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))


def hexof(rgb):
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in rgb)


def profile_of(path):
    run = subprocess.run(["sips", "-g", "profile", str(path)], capture_output=True, text=True)
    return run.stdout.strip().splitlines()[-1].split("profile:")[-1].strip() if run.returncode == 0 else ""


def load(path):
    profile = profile_of(path)
    if profile and profile != "<nil>" and not profile.startswith("sRGB"):
        raise SystemExit(f"{path} is tagged {profile}; convert it to sRGB first (reference.mjs does)")
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)


def crop(img, box):
    x, y, w, h = (v * SCALE for v in box)
    return img[y : y + h, x : x + w]


def luminance(rgb):
    return rgb[..., :3] @ np.array([0.2126, 0.7152, 0.0722])


def edge_boxes(rgb, valid):
    lum = luminance(rgb)
    grad = np.hypot(ndimage.sobel(lum, 0), ndimage.sobel(lum, 1))
    mask = (grad > 60) & valid
    mask = ndimage.binary_closing(mask, np.ones((5, 5)))
    labels, count = ndimage.label(mask)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(labels)):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < 36 or h < 4 or w < 4:
            continue
        boxes.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    return boxes


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0


def edges(ref, demo, valid, origin):
    rb, db = edge_boxes(ref, valid), edge_boxes(demo, valid)
    matched, unmatched = [], []
    for r in rb:
        best = max(db, key=lambda d: iou(r, d), default=None)
        if best is None or iou(r, best) < 0.3:
            unmatched.append(r)
            continue
        offsets = [(best[i] - r[i]) / SCALE for i in range(4)]
        matched.append((max(abs(o) for o in offsets), offsets, r))
    worst = sorted(matched, key=lambda m: -m[0])[:6]
    return {
        "elements": len(rb),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "mean_px": round(float(np.mean([m[0] for m in matched])), 2) if matched else None,
        "max_px": round(float(max((m[0] for m in matched), default=0)), 2),
        "within_1px": round(sum(m[0] <= 1 for m in matched) / len(matched), 3) if matched else None,
        "worst": [
            {"at": [round(origin[0] + m[2][0] / SCALE, 1), round(origin[1] + m[2][1] / SCALE, 1)], "size": [round((m[2][2] - m[2][0]) / SCALE, 1), round((m[2][3] - m[2][1]) / SCALE, 1)], "dLTRB": m[1]}
            for m in worst
        ],
    }


def flatness(lum):
    return ndimage.maximum_filter(lum, size=5) - ndimage.minimum_filter(lum, size=5)


def fills(ref, demo, valid):
    flat_ref = flatness(luminance(ref)[::2, ::2]) < 2.5
    flat_demo = flatness(luminance(demo)[::2, ::2]) < 2.5
    flat = flat_ref & flat_demo & valid[::2, ::2]
    if flat.sum() < 20:
        return {"flat_px": int(flat.sum())}
    r, d = ref[::2, ::2, :3][flat], demo[::2, ::2, :3][flat]
    de = delta_e2000(srgb_to_lab(r), srgb_to_lab(d))
    labels, count = ndimage.label(flat_ref & valid[::2, ::2])
    areas = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
    patches = []
    for index in np.argsort(-areas)[:8]:
        if areas[index] < 30:
            break
        where = labels == index + 1
        rc = ref[::2, ::2, :3][where].mean(0)
        dc = demo[::2, ::2, :3][where].mean(0)
        ys, xs = np.nonzero(where)
        patches.append({"at": [int(xs.min()), int(ys.min())], "area_px": int(areas[index]), "ref": hexof(rc), "demo": hexof(dc), "dE": round(float(delta_e2000(srgb_to_lab(rc), srgb_to_lab(dc))), 2)})
    return {"flat_px": int(flat.sum()), "mean_dE": round(float(de.mean()), 2), "p95_dE": round(float(np.percentile(de, 95)), 2), "patches": patches}


def text_labels(rgb, valid):
    lum = luminance(rgb)
    background = ndimage.median_filter(lum, size=(1, 61))
    contrast = np.abs(lum - background)
    ink = (contrast > 28) & valid
    rows = ink.sum(1)
    labels = []
    y = 0
    while y < len(rows):
        if rows[y] == 0:
            y += 1
            continue
        start = y
        while y < len(rows) and rows[y] > 0:
            y += 1
        if y - start < 10 or y - start > 70:
            continue
        band = ink[start:y]
        cols = band.sum(0)
        x = 0
        while x < len(cols):
            if cols[x] == 0:
                x += 1
                continue
            left, gap = x, 0
            while x < len(cols) and gap < 14:
                gap = gap + 1 if cols[x] == 0 else 0
                x += 1
            right = x - gap
            if right - left < 12:
                continue
            word = band[:, left:right]
            counts = word.sum(1)
            dense = np.nonzero(counts >= 0.4 * counts.max())[0]
            weight = float(contrast[start:y, left:right][word].mean() * word.mean())
            labels.append({"box": (left, start, right, y), "baseline": start + int(dense.max()) + 1, "xtop": start + int(dense.min()), "top": start, "width": right - left, "weight": weight})
    return labels


def text(ref, demo, valid, origin):
    rl, dl = text_labels(ref, valid), text_labels(demo, valid)
    pairs = []
    for r in rl:
        best = max(dl, key=lambda d: iou(r["box"], d["box"]), default=None)
        if best is None or iou(r["box"], best["box"]) < 0.25:
            continue
        pairs.append(
            {
                "at": [round(origin[0] + r["box"][0] / SCALE, 1), round(origin[1] + r["box"][1] / SCALE, 1)],
                "baseline": (best["baseline"] - r["baseline"]) / SCALE,
                "size": ((best["baseline"] - best["top"]) - (r["baseline"] - r["top"])) / SCALE,
                "xheight": ((best["baseline"] - best["xtop"]) - (r["baseline"] - r["xtop"])) / SCALE,
                "width": round(best["width"] / r["width"], 3),
                "weight": round(best["weight"] / r["weight"], 3) if r["weight"] else None,
            }
        )
    if not pairs:
        return {"labels": len(rl), "matched": 0}
    worst = sorted(pairs, key=lambda p: -(abs(p["baseline"]) + abs(p["size"]) + abs(1 - p["width"]) * 20))[:6]
    return {
        "labels": len(rl),
        "matched": len(pairs),
        "baseline_mean_px": round(float(np.mean([abs(p["baseline"]) for p in pairs])), 2),
        "size_mean_px": round(float(np.mean([abs(p["size"]) for p in pairs])), 2),
        "xheight_mean_px": round(float(np.mean([abs(p["xheight"]) for p in pairs])), 2),
        "width_ratio": round(float(np.median([p["width"] for p in pairs])), 3),
        "weight_ratio": round(float(np.median([p["weight"] for p in pairs if p["weight"]])), 3),
        "worst": worst,
    }


def images(ref, demo, valid, base):
    r = np.where(valid[..., None], ref[..., :3], 0).astype(np.uint8)
    d = np.where(valid[..., None], demo[..., :3], 0).astype(np.uint8)
    h, w = r.shape[:2]
    side = np.zeros((h, w * 2 + 8, 3), np.uint8)
    side[:, :w], side[:, w + 8 :] = r, d
    Image.fromarray(side).save(f"{base}-side.png")
    diff = np.abs(r.astype(int) - d.astype(int)).sum(-1)
    heat = np.clip(diff * 3, 0, 255).astype(np.uint8)
    grey = (luminance(r) * 0.35).astype(np.uint8)
    Image.fromarray(np.stack([np.maximum(grey, heat), grey, grey], -1)).save(f"{base}-diff.png")
    Image.fromarray(((r.astype(int) + d.astype(int)) // 2).astype(np.uint8)).save(f"{base}-onion.png")


def load_layout(path):
    try:
        return {c["key"]: c["box"] for c in json.loads(Path(path).read_text())}
    except (OSError, ValueError):
        return None


def layout(ref_layout, demo_layout, box):
    if ref_layout is None or demo_layout is None:
        return {"components": None}
    x, y, w, h = box
    rows, missing = [], []
    for key, r in ref_layout.items():
        cx, cy = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        if not (x <= cx < x + w and y <= cy < y + h) or r[2] - r[0] > w + 2 or r[3] - r[1] > h + 2:
            continue
        d = demo_layout.get(key)
        if d is None:
            missing.append(key)
            continue
        delta = [round(d[i] - r[i], 2) for i in range(4)]
        rows.append({"key": key, "ref": [round(v, 2) for v in r], "dLTRB": delta, "max": max(abs(v) for v in delta)})
    worst = sorted(rows, key=lambda row: -row["max"])[:8]
    return {
        "components": len(rows),
        "missing": missing[:10],
        "max_px": round(max((row["max"] for row in rows), default=0), 2),
        "mean_px": round(float(np.mean([row["max"] for row in rows])), 2) if rows else None,
        "within_1px": round(sum(row["max"] <= 1 for row in rows) / len(rows), 3) if rows else None,
        "worst": worst,
    }


def verdict(result):
    checks = []
    e, f, t, l = result.get("edges", {}), result.get("fills", {}), result.get("text", {}), result.get("layout", {})
    if l.get("components"):
        checks.append(l["max_px"] <= 1)
    elif e.get("max_px") is not None:
        checks.append(e["max_px"] <= 1)
    if f.get("p95_dE") is not None:
        checks.append(f["p95_dE"] <= 2)
    if t.get("matched"):
        checks.append(t["baseline_mean_px"] <= 0.5 and t["size_mean_px"] <= 0.5 and abs(1 - t["width_ratio"]) <= 0.02 and abs(1 - t["weight_ratio"]) <= 0.1)
    return "pass" if checks and all(checks) else "fail"


def main():
    np.seterr(all="ignore")
    ref_dir, out_dir, themes, states = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].split(","), sys.argv[4].split(",")
    only = [r for r in (sys.argv[5] if len(sys.argv) > 5 else "").split(",") if r]
    results = []
    for theme in themes:
        for state in states:
            ref_path, demo_path = ref_dir / theme / f"{state}.png", out_dir / theme / f"{state}.demo.png"
            if not demo_path.exists():
                continue
            if not ref_path.exists():
                results.append({"theme": theme, "state": state, "region": "*", "verdict": "no reference"})
                continue
            ref, demo = load(ref_path), load(demo_path)
            ref_layout = load_layout(ref_dir / theme / f"{state}.layout.json")
            demo_layout = load_layout(out_dir / theme / f"{state}.demo.layout.json")
            if ref.shape != demo.shape:
                results.append({"theme": theme, "state": state, "region": "*", "verdict": f"size {ref.shape} vs {demo.shape}"})
                continue
            for name, region in REGIONS.items():
                if state not in region["states"] or (only and name not in only):
                    continue
                r, d = crop(ref, region["box"]), crop(demo, region["box"])
                valid = r[..., 3] > 250
                base = out_dir / theme / f"{state}-{name}"
                images(r, d, valid, base)
                result = {"theme": theme, "state": state, "region": name, "edges": edges(r, d, valid, region["box"]), "fills": fills(r, d, valid), "text": text(r, d, valid, region["box"]) if region.get("text", True) else {"labels": 0, "matched": 0}, "layout": layout(ref_layout, demo_layout, region["box"]), "images": str(base) + "-{side,diff,onion}.png"}
                result["verdict"] = verdict(result)
                results.append(result)
    (out_dir / "results.json").write_text(json.dumps(results, indent=1))
    for r in results:
        if "edges" not in r:
            print(f"{r['theme']:5} {r['state']:8} {r['region']:8} {r['verdict']}")
            continue
        e, f, t, l = r["edges"], r["fills"], r["text"], r["layout"]
        print(
            f"{r['theme']:5} {r['state']:8} {r['region']:8} {r['verdict']:4}  layout max {l.get('max_px')} mean {l.get('mean_px')} n {l.get('components')}"
            f" | edges max {e['max_px']} mean {e['mean_px']} matched {e['matched']}/{e['elements']}"
            f" | fills mean dE {f.get('mean_dE')} p95 {f.get('p95_dE')}"
            f" | text {t.get('matched')}/{t.get('labels')} baseline {t.get('baseline_mean_px')} size {t.get('size_mean_px')} width {t.get('width_ratio')} weight {t.get('weight_ratio')}"
        )
    print(f"details: {out_dir / 'results.json'}")


main()
