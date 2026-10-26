import { curve } from "../ui/motion";
import { colorRoles, ink, type ShadowLevel } from "../ui/tokens";

const PANEL_SHADOW_OPACITY = { dark: colorRoles.dark.panelShadowOpacity, light: colorRoles.light.panelShadowOpacity };

const DARK = {
  statusFill: "rgba(40,38,39,0.96)",
  statusBorder: "rgba(255,255,255,0.12)",
  statusText: "#FFFFFFD9",
  crashedBackground: "#1C1A1B",
  unresponsiveScrim: "rgba(0,0,0,0.35)",
  frozenWash: "rgba(0,0,0,0.25)",
  swipeChevron: "#FFFFFFD9",
  swipeRim: "rgba(255,255,255,0.15)",
  swipeSelection: "rgba(255,255,255,0.1)",
};

const LIGHT: typeof DARK = {
  statusFill: "rgba(250,249,250,0.97)",
  statusBorder: "rgba(0,0,0,0.12)",
  statusText: "#000000C7",
  crashedBackground: "#F6F5F6",
  unresponsiveScrim: "rgba(0,0,0,0.12)",
  frozenWash: "rgba(255,255,255,0.4)",
  swipeChevron: "#000000D9",
  swipeRim: "rgba(0,0,0,0.125)",
  swipeSelection: "rgba(0,0,0,0.1)",
};

export type WindowColors = typeof DARK;

export const windowColors = (dark: boolean): WindowColors => (dark ? DARK : LIGHT);

export const SWIPE_CONFIRMED_WASH = "rgba(255,255,255,0.4)";

export const DEV_ERROR = { background: "#1b1416", text: "#ff8a8a", fontSize: 14, fontFamily: "Menlo" } as const;

export const SAD_TAB_TITLE_SIZE = 17;

export const SHADOWS = {
  status: { color: ink.black, opacity: { dark: 0.3, light: 0.1 }, radius: 6, offset: [0, 2] },
  unresponsive: { color: ink.black, opacity: PANEL_SHADOW_OPACITY, radius: 20, offset: [0, 8] },
  cliPill: { color: ink.black, opacity: PANEL_SHADOW_OPACITY, radius: 14, offset: [0, 4] },
  sidebarPeek: { color: ink.black, opacity: PANEL_SHADOW_OPACITY, radius: 20, offset: [0, 6] },
  swipe: { color: ink.black, opacity: { dark: 0.25, light: 0.2 }, radius: 8, offset: [0, 2] },
} satisfies Record<string, ShadowLevel>;

export const STATUS_MOTION = {
  show: { duration: 90, easing: curve.outQuad },
  hide: { duration: 220, easing: curve.inQuad },
} as const;

export const CLI_PILL_MOTION = {
  show: { duration: 160, easing: curve.outCubic },
  hide: { duration: 200, easing: curve.inQuad },
} as const;

export const SWIPE_MOTION = {
  confirm: { duration: 180, easing: curve.fade },
  list: { duration: 220, easing: curve.fade },
  dismiss: { duration: 200, easing: curve.inEase },
} as const;
