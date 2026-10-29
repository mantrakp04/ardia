import { TAB_GROUP_COLORS } from "@ardia/core";
import type { GroupColor } from "../browser/types";

export type GroupTint = Exclude<GroupColor, "none">;

export const GROUP_COLORS: Record<GroupTint, { name: string; hex: string }> = {
  grey: { name: "Grey", hex: "#8E8E93" },
  blue: { name: "Blue", hex: "#4C8DF6" },
  red: { name: "Red", hex: "#E5534B" },
  yellow: { name: "Yellow", hex: "#E3B341" },
  green: { name: "Green", hex: "#3FB06C" },
  pink: { name: "Pink", hex: "#DB61A2" },
  purple: { name: "Purple", hex: "#9B6CF0" },
  cyan: { name: "Cyan", hex: "#35B8C6" },
  orange: { name: "Orange", hex: "#EE8434" },
};

export const NEUTRAL_GROUP_SWATCH = { light: "#0000004D", dark: "#FFFFFF4D" };

export const NO_GROUP_COLOR_SWATCH = "#00000000";

export const GROUP_COLOR_ORDER: readonly GroupTint[] = TAB_GROUP_COLORS;

export function nearestGroupColor(color: string): GroupTint | null {
  const m = color.trim().match(/^#?([0-9a-f]{6})/i) ?? color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const rgb = m.length === 2 ? [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) : [+m[1]!, +m[2]!, +m[3]!];
  const hsl = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r / 255 ? ((g - b) / 255 / d + 6) % 6 : max === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4;
    return { h: h * 60, s, l };
  };
  const target = hsl(rgb[0]!, rgb[1]!, rgb[2]!);
  if (target.s < 0.18 || target.l < 0.12 || target.l > 0.92) return null;
  let best: GroupTint | null = null;
  let bestDistance = Infinity;
  for (const [id, { hex }] of Object.entries(GROUP_COLORS) as [GroupTint, { hex: string }][]) {
    if (id === "grey") continue;
    const n = parseInt(hex.slice(1), 16);
    const c = hsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const dh = Math.min(Math.abs(c.h - target.h), 360 - Math.abs(c.h - target.h));
    if (dh < bestDistance) [best, bestDistance] = [id, dh];
  }
  return best;
}
