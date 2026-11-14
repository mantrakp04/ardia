import { hslToRgb, isHexColor, luminance, parseColor, rgbToHsl, toHex } from "../../lib/color";
import { SCOPE_PULSE, SITE_BRAND_COLORS } from "./tokens";

export function brandColorFor(host: string): string | null {
  let h = host.trim().toLowerCase().replace(/^www\./, "");
  while (h.includes(".")) {
    const color = SITE_BRAND_COLORS[h];
    if (color) return color;
    h = h.slice(h.indexOf(".") + 1);
  }
  return null;
}

export function pulseInk(color: string | null, { dark, neutral, fallback }: { dark: boolean; neutral: string; fallback: string }): string {
  if (!color || !isHexColor(color)) return fallback;
  const [r, g, b] = parseColor(color).map((v) => v / 255) as [number, number, number];
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < SCOPE_PULSE.neutralBelowSaturation) return neutral;
  const [low, high] = dark ? SCOPE_PULSE.luminance.dark : SCOPE_PULSE.luminance.light;
  const at = (lightness: number) => toHex(hslToRgb(h, s, lightness).map((v) => v * 255));
  const own = luminance(color);
  if (own >= low && own <= high) return at(l);
  const target = own < low ? low : high;
  let [from, to] = own < low ? [l, 1] : [0, l];
  for (let i = 0; i < 16; i++) {
    const mid = (from + to) / 2;
    if (luminance(at(mid)) < target) from = mid;
    else to = mid;
  }
  return at(own < low ? to : from);
}
