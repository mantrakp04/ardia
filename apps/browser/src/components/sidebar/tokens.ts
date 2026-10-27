import { layout, useTheme } from "../ui/theme";
import { colorRoles, ink, shadow, type ShadowLevel } from "../ui/tokens";
import { useSettings } from "../../state/browser/hooks";
import type { GroupColor } from "../../state/browser/types";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";

const DARK = {
  groupFill: "rgba(255,255,255,0.1)",
  groupFillEmphasized: "rgba(255,255,255,0.12)",
  groupHeaderHover: "rgba(255,255,255,0.12)",
  groupStroke: "rgba(255,255,255,0.1)",
  groupTitle: "#FFFFFF",
  countPill: "rgba(255,255,255,0.15)",
  multiSelected: "rgba(255,255,255,0.1)",
  multiSelectedStroke: "rgba(255,255,255,0.14)",
  dragBorder: "rgba(255,255,255,0.33)",
  dragSilhouette: "#0F0F14",
  switcherFocus: "rgba(255,255,255,0.3)",
  switcherOutline: "rgba(255,255,255,0.15)",
  pickerCellHover: "rgba(255,255,255,0.25)",
  badge: "rgba(255,255,255,0.9)",
  upsellButton: "rgba(255,255,255,0.08)",
  upsellButtonHover: "rgba(255,255,255,0.11)",
  newTabLabel: "#FFFFFF8C",
  newTabIcon: "#FFFFFF40",
  noGroupIcon: "#FFFFFF40",
  folderDropFill: "rgba(255,255,255,0.08)",
  folderMosaic: "rgba(255,255,255,0.1)",
  liveDotRing: "rgba(0,0,0,0.3)",
  engineMarkPlate: "#2C2C2E",
  incognitoBadge: "rgba(255,255,255,0.08)",
  tileGlow: "#FFFFFF",
};

const LIGHT: typeof DARK = {
  groupFill: "rgba(0,0,0,0.05)",
  groupFillEmphasized: "rgba(0,0,0,0.07)",
  groupHeaderHover: "rgba(255,255,255,0.4)",
  groupStroke: "rgba(0,0,0,0.1)",
  groupTitle: "#000000D9",
  countPill: "rgba(0,0,0,0.15)",
  multiSelected: "rgba(0,0,0,0.1)",
  multiSelectedStroke: "rgba(0,0,0,0.08)",
  dragBorder: "rgba(0,0,0,0.28)",
  dragSilhouette: "#FFFFFF",
  switcherFocus: "rgba(0,0,0,0.18)",
  switcherOutline: "rgba(0,0,0,0.1)",
  pickerCellHover: "rgba(134,136,141,0.25)",
  badge: "rgba(0,0,0,0.75)",
  upsellButton: "rgba(0,0,0,0.08)",
  upsellButtonHover: "rgba(0,0,0,0.11)",
  newTabLabel: "#00000080",
  newTabIcon: "#00000042",
  noGroupIcon: "#00000040",
  folderDropFill: "rgba(0,0,0,0.05)",
  folderMosaic: "rgba(0,0,0,0.06)",
  liveDotRing: "rgba(0,0,0,0.1)",
  engineMarkPlate: "#FFFFFF",
  incognitoBadge: "rgba(0,0,0,0.06)",
  tileGlow: "#000000",
};

type SidebarTokens = typeof DARK;

export function useSidebarTokens(): SidebarTokens {
  return useTheme().dark ? DARK : LIGHT;
}

export function sidebarTokens(theme: { dark: boolean }): SidebarTokens {
  return theme.dark ? DARK : LIGHT;
}

const panelShadow = (share: number) => ({ dark: colorRoles.dark.panelShadowOpacity * share, light: colorRoles.light.panelShadowOpacity * share });

export const SIDEBAR_SHADOW = {
  dragGhost: { color: ink.black, opacity: { dark: 0.45, light: 0.18 }, radius: 10, offset: [0, 4] },
  card: { color: ink.black, opacity: panelShadow(0.8), radius: 16, offset: [0, 6] },
  iconPicker: { color: ink.black, opacity: panelShadow(1), radius: 20, offset: [0, 8] },
  searchTabs: shadow.dialog,
  tabSwitcher: { color: ink.black, opacity: panelShadow(1), radius: 28, offset: [0, 12] },
} satisfies Record<string, ShadowLevel>;

export const SELECTED_ROW_SHADOW_OFFSET: [number, number] = [0, 0.5];

export const TILE_GLOW = { opacity: { dark: 0.15, light: 0.12 }, radius: 1.5, offset: [0, 0.5] as [number, number] };

export const SIDEBAR_MOTION = { liveFold: 360, fold: 150, listSlide: 140, listFade: 100, pressIn: 80, pressOut: 180, hoverCardFade: 100 } as const;

export const TABULAR_NUMS: ("tabular-nums")[] = ["tabular-nums"];

export const SIDEBAR_TYPE = { divider: 10, count: 10, cardAction: 10.5, compact: 12.5, searchField: 16, emoji: 18 } as const;

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

export function groupTint(color: GroupColor | null | undefined): string | null {
  return color && color !== "none" ? (GROUP_COLORS[color]?.hex ?? null) : null;
}

export function groupSurface(color: GroupColor | null | undefined, tokens: SidebarTokens): { fill: string; stroke: string } {
  if (color === "none") return { fill: "transparent", stroke: "transparent" };
  const tint = groupTint(color);
  return tint ? { fill: withAlpha(tint, 0.16), stroke: withAlpha(tint, 0.3) } : { fill: tokens.groupFill, stroke: tokens.groupStroke };
}

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

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 400;

export function useSidebarWidth(windowId: string): number {
  const saved = useSettings((st) => st.sidebarWidth ?? layout.sidebarWidth);
  const dragging = useSidebarUi((u) => u.dragWidth[windowId]);
  return dragging ?? saved;
}
