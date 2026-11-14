export type Rgba = [number, number, number, number];

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

export function parseColor(color: unknown): Rgba | null {
  if (typeof color !== "string") return null;
  const text = color.trim();
  const hex = text.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const digits = hex[1]!;
    const full = digits.length === 3 || digits.length === 4 ? [...digits].map((d) => d + d).join("") : digits;
    if (full.length !== 6 && full.length !== 8) return null;
    const value = parseInt(full.slice(0, 6), 16);
    const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
  }
  const fn = text.match(/^rgba?\(([^)]+)\)$/i);
  if (!fn) return null;
  const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean).map((part) => (part.endsWith("%") ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part)));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const alpha = parts[3] ?? 1;
  return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, alpha > 1 ? alpha / 255 : alpha];
}

export function rgbaString([r, g, b, a]: Rgba): string {
  const channel = (value: number) => Math.round(clampUnit(value) * 255);
  return `rgba(${channel(r)},${channel(g)},${channel(b)},${+clampUnit(a).toFixed(4)})`;
}

export function withOpacity(color: unknown, opacity: number): string | undefined {
  const parsed = parseColor(color);
  if (parsed) return rgbaString([parsed[0], parsed[1], parsed[2], parsed[3] * opacity]);
  return typeof color === "string" ? color : undefined;
}

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function toOklab([r, g, b, a]: Rgba): Rgba {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, a];
}

function fromOklab([L, A, B, alpha]: Rgba): Rgba {
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    clampUnit(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clampUnit(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clampUnit(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    alpha,
  ];
}

export function mixOklab(from: Rgba, to: Rgba, t: number): Rgba {
  const a = toOklab(from), b = toOklab(to);
  return fromOklab([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]);
}

export function sampleStops(stops: Rgba[], t: number): Rgba {
  if (stops.length === 0) return [0, 0, 0, 0];
  if (stops.length === 1) return stops[0]!;
  const position = clampUnit(t) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  return mixOklab(stops[index]!, stops[index + 1]!, position - index);
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

export function adjustingLightness([r, g, b, a]: Rgba, delta: number): Rgba {
  const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
  const l = (maxC + minC) / 2;
  let h = 0, s = 0;
  if (maxC !== minC) {
    const d = maxC - minC;
    s = l > 0.5 ? d / (2 - maxC - minC) : d / (maxC + minC);
    h = maxC === r ? (g - b) / d + (g < b ? 6 : 0) : maxC === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const [nr, ng, nb] = hslToRgb(h, s, clampUnit(l + delta));
  return [nr, ng, nb, a];
}

export function flatStops(flat: unknown, limit = 3): Rgba[] {
  if (!Array.isArray(flat)) return [];
  const stops: Rgba[] = [];
  for (let i = 0; i + 3 < flat.length && stops.length < limit; i += 4) {
    const [r, g, b, a] = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]].map(Number);
    if ([r, g, b, a].every((v) => Number.isFinite(v))) stops.push([r!, g!, b!, a!]);
  }
  return stops;
}
