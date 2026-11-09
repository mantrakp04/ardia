import base64
import os
import struct
import tempfile
import time
import zlib
from pathlib import Path

from ardia_cli.browse import snapshot
from ardia_cli.browse.commands import Result, command, parse
from ardia_cli.browse.errors import BrowseError

FONT = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
}
LABEL = (230, 30, 60)
WHITE = (255, 255, 255)


class Image:
    def __init__(self, width: int, height: int, pixels: bytearray):
        self.width = width
        self.height = height
        self.pixels = pixels

    def put(self, x: int, y: int, color):
        if 0 <= x < self.width and 0 <= y < self.height:
            offset = (y * self.width + x) * 4
            self.pixels[offset:offset + 3] = bytes(color)
            self.pixels[offset + 3] = 255

    def fill(self, left, top, right, bottom, color):
        for y in range(max(0, top), min(self.height, bottom)):
            for x in range(max(0, left), min(self.width, right)):
                self.put(x, y, color)

    def outline(self, left, top, right, bottom, color, thickness=2):
        self.fill(left, top, right, top + thickness, color)
        self.fill(left, bottom - thickness, right, bottom, color)
        self.fill(left, top, left + thickness, bottom, color)
        self.fill(right - thickness, top, right, bottom, color)

    def text(self, x, y, value: str, color, scale=2):
        for char in value:
            glyph = FONT.get(char)
            if glyph:
                for row, bits in enumerate(glyph):
                    for column, bit in enumerate(bits):
                        if bit == "1":
                            self.fill(x + column * scale, y + row * scale, x + (column + 1) * scale, y + (row + 1) * scale, color)
            x += 6 * scale


def decode_png(data: bytes) -> Image:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise BrowseError("Not a PNG image")
    offset = 8
    width = height = depth = color_type = interlace = None
    chunks = []
    while offset < len(data):
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        body = data[offset + 8:offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            chunks.append(body)
        elif kind == b"IEND":
            break
    if depth != 8 or color_type not in (2, 6) or interlace:
        raise BrowseError("Only 8-bit RGB or RGBA non-interlaced PNGs are supported")
    channels = 4 if color_type == 6 else 3
    raw = zlib.decompress(b"".join(chunks))
    stride = width * channels
    previous = bytearray(stride)
    out = bytearray(width * height * 4)
    position = 0
    for y in range(height):
        kind = raw[position]
        line = bytearray(raw[position + 1:position + 1 + stride])
        position += 1 + stride
        if kind == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif kind == 2:
            for i in range(stride):
                line[i] = (line[i] + previous[i]) & 255
        elif kind == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + previous[i]) >> 1)) & 255
        elif kind == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = previous[i]
                c = previous[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        if channels == 4:
            out[y * width * 4:(y + 1) * width * 4] = line
        else:
            row = y * width * 4
            for x in range(width):
                out[row + x * 4:row + x * 4 + 3] = line[x * 3:x * 3 + 3]
                out[row + x * 4 + 3] = 255
        previous = line
    return Image(width, height, out)


def encode_png(image: Image) -> bytes:
    rows = bytearray()
    stride = image.width * 4
    for y in range(image.height):
        rows.append(0)
        rows.extend(image.pixels[y * stride:(y + 1) * stride])

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", image.width, image.height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 6)) + chunk(b"IEND", b"")


def default_path(ctx, extension: str) -> str:
    folder = ctx.env.get("AGENT_BROWSER_SCREENSHOT_DIR") or ctx.options.get("screenshot_dir")
    if folder:
        folder = ctx.path(folder)
    else:
        folder = os.path.join(tempfile.gettempdir(), "ardia-browse", "screenshots")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    return os.path.join(folder, f"screenshot-{int(time.time() * 1000)}.{extension}")


async def capture_png(page, full: bool = False, clip: dict | None = None, fmt: str = "png", quality: int | None = None) -> bytes:
    params = {"format": fmt, "fromSurface": True}
    if quality is not None and fmt == "jpeg":
        params["quality"] = quality
    if full:
        metrics = await page.send("Page.getLayoutMetrics")
        size = metrics.get("cssContentSize") or metrics.get("contentSize")
        params["clip"] = {"x": 0, "y": 0, "width": size["width"], "height": size["height"], "scale": 1}
        params["captureBeyondViewport"] = True
    elif clip:
        params["clip"] = clip
        params["captureBeyondViewport"] = True
    result = await page.send("Page.captureScreenshot", params, timeout=60)
    return base64.b64decode(result["data"])


def in_image(box: dict, region: tuple[float, float, float, float]) -> bool:
    left, top, right, bottom = region
    return box["width"] > 0 and box["height"] > 0 and box["x"] < right and box["x"] + box["width"] > left \
        and box["y"] < bottom and box["y"] + box["height"] > top


async def annotations(ctx, page, full: bool = False):
    await snapshot.take(ctx.state, page, interactive=True)
    rows = []
    metrics = await page.send("Page.getLayoutMetrics")
    viewport = metrics.get("cssVisualViewport") or {}
    width, height = viewport.get("clientWidth") or 0, viewport.get("clientHeight") or 0
    region = (0, 0, width, height)
    if full:
        content = metrics.get("cssContentSize") or metrics.get("contentSize") or {}
        scroll_x, scroll_y = viewport.get("pageX") or 0, viewport.get("pageY") or 0
        region = (-scroll_x, -scroll_y, (content.get("width") or width) - scroll_x, (content.get("height") or height) - scroll_y)
    for ref in ctx.state.snapshot_refs():
        try:
            quads = (await page.send("DOM.getContentQuads", {"backendNodeId": ref.backend})).get("quads") or []
        except BrowseError:
            quads = []
        if not quads:
            continue
        xs, ys = quads[0][0::2], quads[0][1::2]
        box = {"x": round(min(xs)), "y": round(min(ys)), "width": round(max(xs) - min(xs)), "height": round(max(ys) - min(ys))}
        entry = {"number": int(ref.id[1:]), "ref": ref.id, "role": ref.role, "box": box}
        if ref.name:
            entry["name"] = ref.name
        if in_image(box, region):
            rows.append(entry)
    return rows, viewport


def draw_annotations(png: bytes, rows: list, viewport: dict, full_offset: tuple[float, float] | None) -> bytes:
    image = decode_png(png)
    css_width = viewport.get("clientWidth") or image.width
    scale = image.width / css_width if not full_offset else image.width / max(css_width, 1)
    dx, dy = full_offset or (0, 0)
    for row in rows:
        box = row["box"]
        left = int((box["x"] + dx) * scale)
        top = int((box["y"] + dy) * scale)
        right = int((box["x"] + dx + box["width"]) * scale)
        bottom = int((box["y"] + dy + box["height"]) * scale)
        if right <= 0 or bottom <= 0 or left >= image.width or top >= image.height:
            continue
        image.outline(left, top, right, bottom, LABEL, max(2, int(scale)))
        label = str(row["number"])
        glyph = max(2, int(scale * 1.5))
        width = len(label) * 6 * glyph + 2 * glyph
        height = 7 * glyph + 2 * glyph
        label_top = top - height if top - height >= 0 else top
        image.fill(left, label_top, left + width, label_top + height, LABEL)
        image.text(left + glyph, label_top + glyph, label, WHITE, glyph)
    return encode_png(image)


@command("screenshot")
async def cmd_screenshot(ctx, argv):
    options, args = parse(argv, {"--full": "bool", "--annotate": "bool", "--screenshot-dir": "value", "--screenshot-format": "value",
                                 "--screenshot-quality": "value"}, {"-f": "--full"})
    for key in ("screenshot_dir", "screenshot_format", "screenshot_quality"):
        if options.get(key):
            ctx.options[key] = options[key]
    full = bool(options.get("full") or ctx.options.get("full"))
    annotate = bool(options.get("annotate") or ctx.options.get("annotate"))
    fmt = (ctx.options.get("screenshot_format") or ctx.env.get("AGENT_BROWSER_SCREENSHOT_FORMAT") or "png").lower()
    if fmt == "jpg":
        fmt = "jpeg"
    if fmt not in ("png", "jpeg"):
        raise BrowseError("--screenshot-format takes png or jpeg")
    quality = ctx.options.get("screenshot_quality") or ctx.env.get("AGENT_BROWSER_SCREENSHOT_QUALITY")
    quality = int(quality) if quality else None
    selector = None
    path = None
    for arg in args:
        if path is None and (arg.lower().endswith((".png", ".jpg", ".jpeg")) or "/" in arg and not arg.startswith("@")):
            path = arg
        elif selector is None:
            selector = arg
        else:
            path = arg
    if annotate and fmt != "png":
        raise BrowseError("--annotate draws on a PNG; drop --screenshot-format jpeg")
    page = await ctx.state.page()
    clip = None
    if selector:
        from ardia_cli.browse.actions import frame_offset, rect

        page, element = await ctx.state.locate(selector)
        await page.send("DOM.scrollIntoViewIfNeeded", {"backendNodeId": element.backend_id})
        box = await rect(page, element)
        ox, oy = await frame_offset(page, element.frame)
        vp = await page.call("() => ardiaBrowse.viewport()", frame=page.main_frame, read=True)
        clip = {"x": box["x"] + ox + vp["scrollX"], "y": box["y"] + oy + vp["scrollY"], "width": max(1, box["width"]), "height": max(1, box["height"]), "scale": 1}
    rows = None
    if annotate:
        rows, viewport = await annotations(ctx, page, full)
    data = await capture_png(page, full, clip, fmt, quality)
    if rows is not None:
        offset = None
        if full:
            vp = await page.call("() => ardiaBrowse.viewport()", frame=page.main_frame, read=True)
            offset = (vp["scrollX"], vp["scrollY"])
        data = draw_annotations(data, rows, viewport, offset)
    target = ctx.path(path) if path else default_path(ctx, "jpg" if fmt == "jpeg" else "png")
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_bytes(data)
    shown = path or target
    text = f"✓ Screenshot saved to {shown}"
    result = {"path": shown}
    if rows is not None:
        result["annotations"] = rows
        legend = [f"   [{row['number']}] @{row['ref']} {row['role']}" + (f" \"{row['name']}\"" if row.get("name") else "") for row in rows]
        text = "\n".join([text] + legend)
    return Result(result, text)


@command("pdf")
async def cmd_pdf(ctx, argv):
    options, args = parse(argv, {"--landscape": "bool", "--format": "value"})
    if not args:
        raise BrowseError("Usage: ardia browse pdf <path>")
    page = await ctx.state.page()
    result = await page.send("Page.printToPDF", {"printBackground": True, "landscape": bool(options.get("landscape"))}, timeout=120)
    target = ctx.path(args[0])
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_bytes(base64.b64decode(result["data"]))
    return Result({"path": args[0]}, f"✓ PDF saved to {args[0]}")


def compare_pngs(before: bytes, after: bytes, threshold: float, output: str | None) -> dict:
    a = decode_png(before)
    b = decode_png(after)
    if (a.width, a.height) != (b.width, b.height):
        return {"match": False, "reason": f"size differs: {a.width}x{a.height} vs {b.width}x{b.height}", "diffPixels": None, "totalPixels": b.width * b.height}
    limit = (threshold * 441.67) ** 2
    diff = Image(a.width, a.height, bytearray(a.width * a.height * 4))
    changed = 0
    pa, pb = a.pixels, b.pixels
    out = diff.pixels
    for i in range(0, len(pa), 4):
        dr, dg, db = pa[i] - pb[i], pa[i + 1] - pb[i + 1], pa[i + 2] - pb[i + 2]
        if dr * dr + dg * dg + db * db > limit:
            changed += 1
            out[i:i + 4] = b"\xff\x00\x00\xff"
        else:
            gray = (pb[i] + pb[i + 1] + pb[i + 2]) // 3
            light = 255 - (255 - gray) // 4
            out[i:i + 4] = bytes((light, light, light, 255))
    total = a.width * a.height
    result = {"match": changed == 0, "diffPixels": changed, "totalPixels": total, "diffPercent": round(changed * 100 / total, 3)}
    if output:
        Path(output).write_bytes(encode_png(diff))
        result["diffPath"] = output
    return result


async def diff_screenshot(ctx, argv):
    options, _ = parse(argv, {"--baseline": "value", "--output": "value", "--threshold": "value", "--selector": "value", "--full": "bool"},
                       {"-b": "--baseline", "-o": "--output", "-t": "--threshold", "-s": "--selector"})
    if not options.get("baseline"):
        raise BrowseError("Usage: ardia browse diff screenshot --baseline <file> [--output <file>] [--threshold 0.1]")
    baseline = Path(ctx.path(options["baseline"])).read_bytes()
    page = await ctx.state.page()
    clip = None
    if options.get("selector"):
        from ardia_cli.browse.actions import rect

        page, element = await ctx.state.locate(options["selector"])
        box = await rect(page, element)
        vp = await page.call("() => ardiaBrowse.viewport()", frame=page.main_frame, read=True)
        clip = {"x": box["x"] + vp["scrollX"], "y": box["y"] + vp["scrollY"], "width": box["width"], "height": box["height"], "scale": 1}
    current = await capture_png(page, bool(options.get("full")), clip)
    output = ctx.path(options["output"]) if options.get("output") else default_path(ctx, "png").replace("screenshot-", "diff-")
    result = compare_pngs(baseline, current, float(options.get("threshold") or 0.1), output)
    if result.get("reason"):
        text = f"✗ Screenshots differ: {result['reason']}"
    elif result["match"]:
        text = "✓ Screenshots match"
    else:
        text = f"✗ {result['diffPixels']} of {result['totalPixels']} pixels differ ({result['diffPercent']}%)\n  diff image: {result['diffPath']}"
    return Result(result, text)
