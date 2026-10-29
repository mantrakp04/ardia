import { useTheme } from "../ui/theme";
import { colorRoles, ink, shadow, withAlpha, type ShadowLevel } from "../ui/tokens";
import type { GroupColor } from "../../state/browser/types";
import { GROUP_COLORS } from "../../state/groups/tokens";

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
  fieldButtonPlate: "rgba(255,255,255,0.08)",
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
  fieldButtonPlate: "rgba(255,255,255,0.75)",
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

export const SIDEBAR_MOTION = { liveFold: 360, fold: 150, listSlide: 140, listFade: 100, hoverCardFade: 100 } as const;

export const TABULAR_NUMS: ("tabular-nums")[] = ["tabular-nums"];

export const SIDEBAR_TYPE = { divider: 10, count: 10, cardAction: 10.5, compact: 12.5, searchField: 16, emoji: 18 } as const;

export function groupTint(color: GroupColor | null | undefined): string | null {
  return color && color !== "none" ? (GROUP_COLORS[color]?.hex ?? null) : null;
}

export function groupSurface(color: GroupColor | null | undefined, tokens: SidebarTokens): { fill: string; stroke: string } {
  if (color === "none") return { fill: "transparent", stroke: "transparent" };
  const tint = groupTint(color);
  return tint ? { fill: withAlpha(tint, 0.16), stroke: withAlpha(tint, 0.3) } : { fill: tokens.groupFill, stroke: tokens.groupStroke };
}

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 400;
