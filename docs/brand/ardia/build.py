"""Ardia's logo assets from the oil-painted "hills" (source/, picked 2026-10-10). Run from the repo root;
the results go to output/brand/ardia/final/, then to their slots (see README.md)."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = Path("docs/brand/ardia/source")
OUT = Path("output/brand/ardia/final")
OUT.mkdir(parents=True, exist_ok=True)
LZ = Image.LANCZOS


def clean_alpha(im, floor=16):
    """Drop the faint flecks around a cut-out and trim to the art."""
    im = im.convert("RGBA")
    a = np.array(im.getchannel("A")).astype(np.int32)
    a = np.where(a < floor, 0, np.clip((a - floor) * 255 // (255 - floor), 0, 255))
    im.putalpha(Image.fromarray(a.astype(np.uint8)))
    return im.crop(im.getbbox())


def rounded_mask(size, box, radius, ss=4):
    m = Image.new("L", (size * ss, size * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([v * ss for v in box], radius * ss, fill=255)
    return m.resize((size, size), LZ)


src = Image.open(SRC / "app-icon.png").convert("RGBA")
art = src.crop((131, 133, 893, 891))
parchment = tuple(int(v) for v in np.median(np.array(art)[8:40, 300:460, :3].reshape(-1, 3), axis=0))
flat = Image.new("RGBA", art.size, parchment + (255,))
flat.alpha_composite(art)
square = flat.resize((1024, 1024), LZ)
square.save(OUT / "tile-square-1024.png")
print("parchment", "#%02X%02X%02X" % parchment)

icon = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
body = (100, 100, 924, 924)
mask = rounded_mask(1024, body, 185.4)
shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
shadow.putalpha(ImageChops.offset(mask, 0, 10).point(lambda v: v * 0.3).filter(ImageFilter.GaussianBlur(12)))
icon.alpha_composite(shadow)
tile = square.resize((824, 824), LZ)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
canvas.paste(tile, (100, 100))
canvas.putalpha(mask)
icon.alpha_composite(canvas)
icon.save(OUT / "icon-1024.png")
for px in (16, 32, 64, 128, 180, 256, 512):
    icon.resize((px, px), LZ).save(OUT / f"icon-{px}.png")

mark = clean_alpha(Image.open(SRC / "mark.png"))
mark.save(OUT / "mark-trim.png")


def fit(im, size, width_frac, bottom=None):
    w = round(size * width_frac)
    h = round(im.height * w / im.width)
    if h > size * width_frac:
        h = round(size * width_frac)
        w = round(im.width * h / im.height)
    small = im.resize((w, h), LZ)
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    y = (size - h) // 2 if bottom is None else size - h - bottom
    c.alpha_composite(small, ((size - w) // 2, y))
    return c


for scale in (1, 2, 3):
    fit(mark, 100 * scale, 0.94, bottom=0).save(OUT / f"ntp-mark{'' if scale == 1 else f'@{scale}x'}.png")

fit(mark, 1024, 0.96).save(OUT / "plate-mark-1024.png")

flat_mark = clean_alpha(Image.open(SRC / "mark-small.png"))
rgb = np.array(flat_mark)[:, :, :3].astype(np.int32)
alpha = np.array(flat_mark)[:, :, 3]
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
sun = (r > 180) & (g > 140) & (b < 140) & (alpha > 128)
light = (g > r + 10) & (g > 110) & ~sun & (alpha > 128)
dark = (alpha > 128) & ~sun & ~light


def grow(m, px):
    return np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(px))) > 127


pt = flat_mark.width / 16
gap = 2 * round(pt * 0.45) + 1
sy, sx = np.nonzero(sun)
sun_r = np.sqrt(sun.sum() / np.pi)
yy, xx = np.mgrid[: sun.shape[0], : sun.shape[1]]
small_sun = np.hypot(xx - sx.mean(), yy - sy.mean()) <= sun_r - pt * 0.3
cut = (grow(light, gap) & grow(dark, gap)) | (grow(sun, 2 * round(pt * 0.25) + 1) & ~sun) | (sun & ~small_sun)
glyph_a = np.where(cut, 0, alpha)
glyph = Image.new("RGBA", flat_mark.size, (0, 0, 0, 255))
glyph.putalpha(Image.fromarray(glyph_a.astype(np.uint8)))
glyph = glyph.crop(glyph.getbbox())
for scale in (1, 2, 3):
    fit(glyph, 16 * scale, 1.0).save(OUT / f"new-tab-mark{'' if scale == 1 else f'@{scale}x'}.png")
fit(glyph, 512, 1.0).save(OUT / "new-tab-mark-512.png")

square.convert("RGB").resize((180, 180), LZ).save(OUT / "apple-touch-icon.png")
print("done")

import sys  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
import hsv_np as hsvlib  # noqa: E402

PROFILE_SWATCHES = {"plum": "#C07A98", "blue": "#4691C3", "purple": "#7873AF", "pink": "#D37B8B", "red": "#C1575C",
                    "orange": "#D87249", "yellow": "#E3AC38", "neutral": "#8E8E93"}
SUNS = {"orange": "#FFD873", "yellow": "#FFF1CF"}


def tinted_marks(base, names=PROFILE_SWATCHES):
    a = np.array(base.convert("RGBA")).astype(np.float32) / 255
    rgb, al = a[..., :3], a[..., 3]
    h, s, v = np.moveaxis(hsvlib.rgb_to_hsv(rgb), -1, 0)

    scale = base.width / 300

    def soft(mask, median, blur):
        size = max(3, int(median * scale) // 2 * 2 + 1)
        img = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(size))
        return np.array(img.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32) / 255

    sun = soft((h > 0.06) & (h < 0.18) & (s > 0.35) & (v > 0.5), 5, 1.2 * scale)
    hill = 1 - sun
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    solid = (hill > 0.9) & (al > 0.5)
    lo, hi = np.percentile(lum[solid], 1), np.percentile(lum[solid], 99.5)
    light_hill = soft((h > 0.15) & (h < 0.33) & (al > 0.5) & (sun < 0.5), 9, 2 * scale)
    t = np.clip((lum - lo) / (hi - lo) + 0.18 * light_hill - 0.1 * (1 - light_hill), 0, 1)

    def ramp(color):
        stops = [(0.0, color * 0.4), (0.55, color * 0.78), (1.0, color + (1 - color) * 0.6)]
        out = np.zeros(t.shape + (3,))
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            k = np.clip((t - t0) / (t1 - t0), 0, 1)[..., None]
            out = np.where(((t >= t0) & (t <= t1))[..., None], c0 + (c1 - c0) * k, out)
        return out

    sun_lum = np.percentile(lum[sun > 0.9], 70)
    for name in names:
        color = hsvlib.to_rgb(PROFILE_SWATCHES[name])
        if name == "neutral":
            color = np.full(3, color @ np.array([0.2126, 0.7152, 0.0722]))
        sun_rgb = rgb if name not in SUNS else np.clip(hsvlib.to_rgb(SUNS[name]) * (lum / sun_lum)[..., None], 0, 1)
        out = ramp(color) * hill[..., None] + sun_rgb * sun[..., None]
        yield name, Image.fromarray((np.dstack([np.clip(out, 0, 1), al]) * 255).astype(np.uint8))


from scipy import ndimage as nd  # noqa: E402

BACK, FRONT, SUN = 0, 1, 2
painting = np.array(mark).astype(np.float32) / 255
known = painting[..., 3] > 0.5
blobs, _ = nd.label(painting[..., 3] > 0.06)
hills_blob = blobs == np.bincount(blobs[blobs > 0]).argmax()
dark = nd.median_filter(hsvlib.rgb_to_hsv(painting[..., :3])[..., 0] > 0.34, 9)
labels = np.where(hills_blob, np.where(dark, FRONT, BACK), SUN)
labels = labels[tuple(nd.distance_transform_edt(~known, return_distances=False, return_indices=True))]


def fit_mask(m, size):
    """A layer mask through `fit`'s geometry (0.94 of the width, bottom edge), box-filtered so it doesn't ring."""
    w = round(size * 0.94)
    h = round(mark.height * w / mark.width)
    out = np.zeros((size, size), np.float32)
    small = Image.fromarray((m * 255).astype(np.uint8)).resize((w, h), Image.BOX)
    out[size - h:, (size - w) // 2:(size - w) // 2 + w] = np.array(small, np.float32) / 255
    return out


def split_layers(comp, size):
    """Alphas of the back, front and sun layers, the back hill's own paint, and where it goes on under the front."""
    a = comp[..., 3]
    cover = np.clip(a / np.median(a[a > 0.5]), 0, 1)
    front, sun = fit_mask(labels == FRONT, size), fit_mask(labels == SUN, size)
    seen = (front < 0.5) & (a > 0.5) & (sun < 0.5)
    front = nd.grey_dilation(front, size=3)
    core = nd.binary_erosion(seen, iterations=max(1, round(0.6 * size / 100)))
    cols = np.nonzero(seen.any(0))[0]
    top = np.where(seen.any(0), seen.argmax(0), size).astype(np.float32)
    notch = cols.max()
    near = np.arange(notch - max(3, round(0.08 * size)), notch + 1)
    slope = np.polyfit(near, top[near], 1)[0]
    x = np.arange(size)
    ridge = np.where(x > notch, top[notch] + slope * (x - notch), top)
    under = (np.arange(size)[:, None] >= ridge[None, :]) & (x >= cols.min())[None, :]
    fill = under & (front > 0.998) & (cover > 0.97)
    back = np.where(fill, a, np.where(cover * front < 0.999, a * (1 - front) / np.maximum(1 - cover * front, 1e-6), 0.0))
    return back * (1 - sun), a * front * (1 - sun), a * sun, core, fill


def spread(values, weight, sigma):
    """`values` averaged over `weight` and carried out past it (normalized convolution); also returns the weight."""
    num = nd.gaussian_filter(values * weight[..., None], (sigma, sigma, 0))
    den = nd.gaussian_filter(weight, sigma)
    return num / np.maximum(den, 1e-6)[..., None], den


def paint_back(comp, core, fill):
    """The back hill under the front one: its own colour, smoothed and carried on, in the front hill's brushstrokes."""
    rgb = comp[..., :3]
    size = rgb.shape[0]
    colour, _ = spread(rgb, core.astype(np.float32), 0.2 * size)
    for sigma in (0.08, 0.03):
        c, den = spread(rgb, core.astype(np.float32), sigma * size)
        colour = np.where((den > 0.05)[..., None], c, colour)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    local, _ = spread(lum[..., None], fill.astype(np.float32), 0.03 * size)
    strokes = np.clip(lum / np.maximum(local[..., 0], 1e-3), 0.5, 1.6) ** 0.8
    return np.where(fill[..., None], np.clip(colour * strokes[..., None], 0, 1), rgb)


def layer(rgb, alpha):
    return Image.fromarray((np.dstack([rgb[..., :3], alpha]) * 255).round().astype(np.uint8))


for scale in (1, 2, 3):
    suffix = "" if scale == 1 else f"@{scale}x"
    base = Image.open(OUT / f"ntp-mark{suffix}.png")
    back, front, sun, core, fill = split_layers(np.array(base).astype(np.float32) / 255, 100 * scale)
    variants = [("", base)] + [(f"-{name}", im) for name, im in tinted_marks(base)]
    for name, im in variants:
        im.save(OUT / f"ntp-mark{name}{suffix}.png", optimize=True)
        comp = np.array(im).astype(np.float32) / 255
        layer(paint_back(comp, core, fill), back).save(OUT / f"ntp-mark{name}-back{suffix}.png", optimize=True)
        layer(comp, front).save(OUT / f"ntp-mark{name}-front{suffix}.png", optimize=True)
        layer(comp, sun).save(OUT / f"ntp-mark{name}-sun{suffix}.png", optimize=True)
    if scale == 3:
        print("layer tops (pt):", [round(np.nonzero((m > 0.02).any(1))[0].min() / 3, 1) for m in (back, front, sun)])
print("tinted marks")

import shutil  # noqa: E402

XCASSETS = Path("apps/browser/macos/Ardia-macOS/Assets.xcassets")
PLATE_MARK_PX = 512
IMAGESET = '{\n  "images" : [\n    {\n      "filename" : "mark.png",\n      "idiom" : "universal"\n    }\n  ],\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  }\n}\n'
slots = {"AppIconMark": OUT / "plate-mark-1024.png"}
for name, im in tinted_marks(Image.open(slots["AppIconMark"]), ("plum", "blue", "neutral")):
    im.save(OUT / f"plate-mark-{name}-1024.png", optimize=True)
    slots[f"AppIconMark-{name}"] = OUT / f"plate-mark-{name}-1024.png"
for slot, path in slots.items():
    folder = XCASSETS / f"{slot}.imageset"
    folder.mkdir(exist_ok=True)
    Image.open(path).resize((PLATE_MARK_PX, PLATE_MARK_PX), LZ).save(folder / "mark.png", optimize=True)
    (folder / "Contents.json").write_text(IMAGESET)
print("plate marks")

import json  # noqa: E402

ICON = Path("apps/browser/macos/Ardia-macOS/AppIcon.icon")


def icon_layers(tile):
    rgb = np.array(tile.convert("RGB")).astype(np.float32) / 255
    fill = np.median(rgb[20:120, 300:700].reshape(-1, 3), axis=0)
    lift = np.where(rgb > fill, (rgb - fill) / np.maximum(1 - fill, 1e-6), (fill - rgb) / np.maximum(fill, 1e-6))
    alpha = np.clip((lift.max(-1) - 0.05) / 0.95, 0, 1)
    colour = np.where(alpha[..., None] > 0, np.clip(fill + (rgb - fill) / np.maximum(alpha, 1e-6)[..., None], 0, 1), 0)
    blobs, _ = nd.label(alpha > 0.5)
    sizes = np.bincount(blobs.ravel())
    sizes[0] = 0
    art = np.isin(blobs, np.nonzero(sizes > 2000)[0])
    alpha = np.where(nd.binary_dilation(art, iterations=4), alpha, 0)
    inside = nd.binary_erosion(nd.binary_fill_holes(art), iterations=3)
    alpha = np.where(inside, 1.0, alpha)
    colour = np.where(inside[..., None], rgb, colour)
    h, s, v = np.moveaxis(hsvlib.rgb_to_hsv(colour), -1, 0)
    sun = nd.median_filter((h > 0.06) & (h < 0.18) & (s > 0.35) & (v > 0.5), 9)
    front = nd.median_filter((h > 0.34) & ~sun, 9)
    parts = np.where(sun, SUN, np.where(front, FRONT, BACK))
    parts = parts[tuple(nd.distance_transform_edt(alpha <= 0.5, return_distances=False, return_indices=True))]
    cut = {part: np.where(parts == part, alpha, 0) for part in (BACK, FRONT, SUN)}
    return fill, {part: layer(np.where(a[..., None] > 0, colour, 0), a) for part, a in cut.items()}


icon_fill, icon_parts = icon_layers(square)
(ICON / "Assets").mkdir(parents=True, exist_ok=True)
groups = []
for part, name in ((SUN, "sun"), (FRONT, "front"), (BACK, "back")):
    icon_parts[part].save(ICON / "Assets" / f"{name}.png", optimize=True)
    groups.append({"layers": [{"glass": False, "image-name": f"{name}.png", "name": name}],
                   "shadow": {"kind": "neutral", "opacity": 0.5}, "specular": False,
                   "translucency": {"enabled": False, "value": 0.5}})
(ICON / "icon.json").write_text(json.dumps({
    "fill": {"solid": "srgb:" + ",".join(f"{c:.5f}" for c in icon_fill) + ",1.00000"},
    "groups": groups,
    "supported-platforms": {"squares": ["macOS"]},
}, indent=2) + "\n")
print("app icon (Icon Composer)")

import base64, io, subprocess, tempfile  # noqa: E401, E402

ENGINE = Path("engine/chromium/src")
BLEED = 0.92


def logo(px):
    """The flat tile (no shadow), centred in a px square where Chromium's round logo sits."""
    big = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    side = round(1024 * BLEED)
    at = (1024 - side) // 2
    tile = square.resize((side, side), LZ)
    tile.putalpha(rounded_mask(side, (0, 0, side, side), side * 185.4 / 824))
    big.alpha_composite(tile, (at, at))
    return big.resize((px, px), LZ)


def put(path, im):
    (ENGINE / path).parent.mkdir(parents=True, exist_ok=True)
    im.save(ENGINE / path, optimize=True)


for size in (16, 24, 48, 64, 128, 256):
    put(f"chrome/app/theme/chromium/product_logo_{size}.png", logo(size))
for scale in (1, 2):
    for size in (16, 32):
        put(f"chrome/app/theme/default_{scale}00_percent/chromium/product_logo_{size}.png", logo(size * scale))
    put(f"components/resources/default_{scale}00_percent/chromium/favicon_product.png", logo(16 * scale))

for scale in (1, 2):
    for name in ("product_logo_name_22", "product_logo_name_22_white"):
        put(f"chrome/app/theme/default_{scale}00_percent/chromium/{name}.png", logo(22 * scale))
    for name in ("product_logo", "product_logo_white"):
        put(f"components/resources/default_{scale}00_percent/chromium/{name}.png", logo(32 * scale))

png = io.BytesIO()
logo(256).save(png, format="PNG", optimize=True)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" '
       'viewBox="0 0 256 256"><image width="256" height="256" xlink:href="data:image/png;base64,'
       + base64.b64encode(png.getvalue()).decode() + '"/></svg>\n')
for name in ("product_logo.svg", "product_logo_animation.svg"):
    (ENGINE / "chrome/app/theme/chromium" / name).write_text(svg)

with tempfile.TemporaryDirectory() as tmp:
    catalog = Path(tmp) / "Assets.xcassets"
    appicon = catalog / "AppIcon.appiconset"
    appicon.mkdir(parents=True)
    (catalog / "Contents.json").write_text('{\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  }\n}\n')
    entries = []
    for pt in (16, 32, 128):
        for scale in (1, 2):
            name = f"icon_{pt}x{pt}_{scale}x.png"
            icon.resize((pt * scale, pt * scale), LZ).save(appicon / name)
            entries.append(f'    {{\n      "filename" : "{name}",\n      "idiom" : "mac",\n      "scale" : "{scale}x",\n'
                           f'      "size" : "{pt}x{pt}"\n    }}')
    (appicon / "Contents.json").write_text('{\n  "images" : [\n' + ",\n".join(entries)
                                           + '\n  ],\n  "info" : {\n    "author" : "xcode",\n    "version" : 1\n  }\n}\n')
    out = Path(tmp) / "out"
    out.mkdir()
    subprocess.run(["xcrun", "actool", str(catalog), "--compile", str(out), "--platform", "macosx",
                    "--minimum-deployment-target", "13.0", "--app-icon", "AppIcon",
                    "--output-partial-info-plist", str(out / "partial.plist")], check=True, capture_output=True)
    mac = ENGINE / "chrome/app/theme/chromium/mac"
    mac.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(out / "AppIcon.icns", mac / "app.icns")
    shutil.copyfile(out / "Assets.car", mac / "Assets.car")
print("chromium logos")
