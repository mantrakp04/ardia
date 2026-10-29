export type Vec4 = [number, number, number, number];

export function parseHex(hex: string): Vec4 | null {
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if ((s.length !== 6 && s.length !== 8) || !/^[0-9a-fA-F]+$/.test(s)) return null;
  const v = parseInt(s.length === 6 ? `${s}FF` : s, 16) >>> 0;
  return [((v >>> 24) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255];
}

const f32 = Math.fround;

export function oklab(c: Vec4): Vec4 {
  const lin = (x: number) => f32(x <= 0.04045 ? f32(x / 12.92) : f32(Math.pow(f32((x + 0.055) / 1.055), 2.4)));
  const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
  const l = f32(Math.cbrt(f32(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)));
  const m = f32(Math.cbrt(f32(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)));
  const s = f32(Math.cbrt(f32(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)));
  return [
    f32(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s),
    f32(1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s),
    f32(0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s),
    c[3],
  ];
}

export const PALETTES: Record<string, string[]> = {
  pink: ["#FF6AFF", "#FE8097", "#FF9966", "#FCE0FF", "#FA62B1"],
  purple: ["#7293FF", "#7D5DFF", "#E263FF", "#FF81EE", "#A585FF"],
  red: ["#FD3131", "#FA607C", "#FDA733", "#FFEBC9", "#F55F5D"],
  orange: ["#FFBB62", "#FE8026", "#FF7C5F", "#FFFCBE", "#FF9D00"],
  yellow: ["#FFD11A", "#FFE23E", "#FFA144", "#F8FFB5", "#FFE30A"],
  green: ["#90CE01", "#43CC60", "#0CD9EB", "#C3EEAF", "#9EDD73"],
  blue: ["#4ACCFF", "#5FADFF", "#60F0CF", "#9CEEFF", "#72C1FF"],
  default: ["#7E1731", "#334CB4", "#2D81FF", "#2D81FF", "#FFF268", "#F70305", "#FE64CD"],
};

export function paletteColors(value: string[] | undefined): Vec4[] | null {
  if (!value) return null;
  const named = value.length === 1 ? PALETTES[value[0]!] : undefined;
  const srgb = (named ?? value).map(parseHex).filter((c): c is Vec4 => !!c);
  return srgb.length ? srgb : null;
}

export function adjustingLightness([r, g, b, a]: Vec4, delta: number): Vec4 {
  const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (maxC + minC) / 2;
  if (maxC !== minC) {
    const d = maxC - minC;
    s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
    h = maxC === r ? (g - b) / d + (g < b ? 6 : 0) : maxC === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l2 = Math.min(Math.max(l + delta, 0), 1);
  if (s === 0) return [l2, l2, l2, a];
  const channel = (p: number, q: number, t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
  const p = 2 * l2 - q;
  return [channel(p, q, h + 1 / 3), channel(p, q, h), channel(p, q, h - 1 / 3), a];
}

export function displayP3([r, g, b]: Vec4, alpha: number): string {
  const n = (v: number) => +v.toFixed(5);
  return `color(display-p3 ${n(r)} ${n(g)} ${n(b)} / ${n(alpha)})`;
}

export function srgbCss([r, g, b]: Vec4, alpha: number): string {
  const n = (v: number) => Math.round(v * 255);
  return `rgba(${n(r)}, ${n(g)}, ${n(b)}, ${+alpha.toFixed(5)})`;
}
