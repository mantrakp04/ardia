import { useTheme } from "../ui/theme";
import { duration } from "../ui/motion";
import { font, ink, shadow, withAlpha, type ShadowLevel } from "../ui/tokens";
import type { GroupColor } from "../../state/browser/types";
import { GROUP_COLORS } from "../../state/groups/tokens";

const DARK = {
  groupFill: "rgba(255,255,255,0.1)",
  groupFillEmphasized: "rgba(255,255,255,0.12)",
  groupHeaderHover: "rgba(255,255,255,0.12)",
  groupStroke: "rgba(255,255,255,0.1)",
  groupTitle: "#FFFFFF",
  multiSelected: "rgba(255,255,255,0.1)",
  multiSelectedStroke: "rgba(255,255,255,0.14)",
  dragBorder: "rgba(255,255,255,0.33)",
  dragSilhouette: "#0F0F14",
  switcherFocus: "rgba(255,255,255,0.3)",
  switcherOutline: "rgba(255,255,255,0.15)",
  badge: "rgba(255,255,255,0.9)",
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
  multiSelected: "rgba(0,0,0,0.1)",
  multiSelectedStroke: "rgba(0,0,0,0.08)",
  dragBorder: "rgba(0,0,0,0.28)",
  dragSilhouette: "#FFFFFF",
  switcherFocus: "rgba(0,0,0,0.18)",
  switcherOutline: "rgba(0,0,0,0.1)",
  badge: "rgba(0,0,0,0.75)",
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


export const SIDEBAR_SHADOW = {
  dragGhost: { color: ink.black, opacity: { dark: 0.45, light: 0.18 }, radius: 10, offset: [0, 4] },
  card: shadow.card,
  searchTabs: shadow.dialog,
  tabSwitcher: { ...shadow.dialog, radius: 28, offset: [0, 12] },
} satisfies Record<string, ShadowLevel>;

export const SELECTED_ROW_SHADOW_OFFSET: [number, number] = [0, 0.5];

export const TILE_GLOW = { opacity: { dark: 0.15, light: 0.12 }, radius: 1.5, offset: [0, 0.5] as [number, number] };

export const SIDEBAR_MOTION = { liveFold: duration.long, fold: duration.base, listSlide: 140, listFade: 100, hoverCardFade: 100 } as const;

export const HOVER_CARD_IN_SPRING = { response: 0.25, damping: 0.75 } as const;
export const HOVER_CARD_OUT_SPRING = { response: 0.2, damping: 0.6 } as const;

export const TAB_ROW = { contentLeft: 9, trailing: 6, titleGap: 5, titleHeight: 18, compactTitleHeight: 17, closeSlot: 22 } as const;

export const TILE_RIM = 1;

export const TABULAR_NUMS: ("tabular-nums")[] = ["tabular-nums"];

export const SIDEBAR_TYPE = { compact: font.small.fontSize } as const;

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
