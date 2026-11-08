import { symbolMarkup, type SymbolLayer } from "./render";

export type InkBox = { x: number; y: number; width: number; height: number };
export type InkShift = readonly [number, number];

const INK_ALPHA_THRESHOLD = 16;
const PIXELS_PER_POINT = 8;
const PROBE_COLOR = "#000";
const measured = new Map<string, InkShift>();

export function inkProbeMarkup(layers: readonly SymbolLayer[], options: Omit<Parameters<typeof symbolMarkup>[1], "color">): string {
  return symbolMarkup(layers, { ...options, color: PROBE_COLOR });
}

export function inkShift(box: InkBox | null, canvas: number): InkShift {
  if (!box || (box.width <= 0 && box.height <= 0)) return [0, 0];
  return [canvas / 2 - (box.x + box.width / 2), canvas / 2 - (box.y + box.height / 2)];
}

export function inkBox(rgba: ArrayLike<number>, width: number, height: number, scale: number): InkBox | null {
  if (width <= 0 || height <= 0 || scale <= 0 || rgba.length < width * height * 4) return null;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) < INK_ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  return { x: left / scale, y: top / scale, width: (right + 1 - left) / scale, height: (bottom + 1 - top) / scale };
}

export function knownInkShift(key: string): InkShift | undefined {
  return measured.get(key);
}

export async function measureInkShift(key: string, markup: string, canvas: number): Promise<InkShift | null> {
  if (!Number.isFinite(canvas) || canvas <= 0) return null;
  const known = measured.get(key);
  if (known) return known;
  const pixels = canvas * PIXELS_PER_POINT;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const surface = document.createElement("canvas");
  surface.width = pixels;
  surface.height = pixels;
  const context = surface.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, pixels, pixels);
  const box = inkBox(context.getImageData(0, 0, pixels, pixels).data, pixels, pixels, PIXELS_PER_POINT);
  if (!box) return null;
  const shift = inkShift(box, canvas);
  measured.set(key, shift);
  return shift;
}
