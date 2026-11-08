const HUE_BINS = 24;
const MIN_SATURATION = 0.28;
const MIN_BRIGHTNESS = 0.22;
const MIN_CHROMATIC_SHARE = 0.08;
const SAMPLE_EDGE = 32;

type Bin = { weight: number; r: number; g: number; b: number; count: number };

function hsv(r: number, g: number, b: number): [number, number, number] {
  const high = Math.max(r, g, b);
  const delta = high - Math.min(r, g, b);
  if (high <= 0 || delta <= 0) return [0, 0, high];
  let hue = high === r ? (g - b) / delta : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue /= 6;
  if (hue < 0) hue += 1;
  return [hue, delta / high, high];
}

const hex = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255).toString(16).padStart(2, "0").toUpperCase();

export function dominantAccent(rgba: ArrayLike<number>): string | null {
  const bins: Bin[] = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0, count: 0 }));
  let opaque = 0;
  let chromatic = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! / 255 < 0.5) continue;
    opaque++;
    const [r, g, b] = [rgba[i]! / 255, rgba[i + 1]! / 255, rgba[i + 2]! / 255];
    const [hue, saturation, brightness] = hsv(r, g, b);
    if (saturation < MIN_SATURATION || brightness < MIN_BRIGHTNESS) continue;
    chromatic++;
    const bin = bins[Math.min(HUE_BINS - 1, Math.floor(hue * HUE_BINS))]!;
    bin.weight += saturation * brightness;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.count++;
  }
  if (!opaque || chromatic / opaque < MIN_CHROMATIC_SHARE) return null;
  const window = (i: number) => [-1, 0, 1].map((offset) => bins[(i + offset + HUE_BINS) % HUE_BINS]!);
  const weightOf = (i: number) => window(i).reduce((sum, bin) => sum + bin.weight, 0);
  let peak = 0;
  for (let i = 1; i < HUE_BINS; i++) if (weightOf(i) > weightOf(peak)) peak = i;
  const chosen = window(peak);
  const count = chosen.reduce((sum, bin) => sum + bin.count, 0);
  if (!count) return null;
  const mean = (key: "r" | "g" | "b") => chosen.reduce((sum, bin) => sum + bin[key], 0) / count;
  return `#${hex(mean("r"))}${hex(mean("g"))}${hex(mean("b"))}`;
}

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The icon couldn't be decoded"));
    image.src = uri;
  });
}

export async function linuxIconAccent(uri: unknown): Promise<string | null> {
  if (typeof uri !== "string" || !/^(data|blob):/i.test(uri) || typeof document === "undefined") return null;
  const image = await loadImage(uri).catch(() => null);
  const longest = image ? Math.max(image.naturalWidth, image.naturalHeight) : 0;
  if (!image || !longest) return null;
  const scale = Math.min(1, SAMPLE_EDGE / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return dominantAccent(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
