export type Rgba = [r: number, g: number, b: number, a: number];

const RGB_FUNCTION = /rgba?\(([^)]+)\)/;

export const isHexColor = (color: string) => /^#[0-9a-f]{6}/i.test(color.trim());

export const isRgbFunction = (color: string) => RGB_FUNCTION.test(color);

export function parseColor(color: string): Rgba {
  const m = RGB_FUNCTION.exec(color);
  if (m) {
    const [r = 0, g = 0, b = 0, a = 1] = m[1]!.split(",").map((v) => Number(v.trim()));
    return [r, g, b, a];
  }
  const h = color.trim().replace("#", "");
  const ch = (i: number) => parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return [ch(0), ch(1), ch(2), h.length >= 8 ? ch(3) / 255 : 1];
}

export const toHex = (channels: readonly number[]) =>
  `#${channels.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

export function mix(a: string, b: string, t: number): string {
  const from = parseColor(a);
  const to = parseColor(b);
  return toHex([0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * t));
}

export function over(top: string, under: string): string {
  const [r, g, b, a] = parseColor(top);
  const base = parseColor(under);
  return toHex([r, g, b].map((v, i) => a * v + (1 - a) * base[i]!));
}

export function luminance(color: string): number {
  if (!isHexColor(color)) return 0;
  const [r, g, b] = parseColor(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgba;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLight(color: string): boolean {
  const l = luminance(color);
  return 1.05 / (l + 0.05) < (l + 0.05) / 0.05;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
