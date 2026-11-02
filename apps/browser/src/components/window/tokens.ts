import { curve, duration } from "../ui/motion";
import { font, ink, radius, shadow, type ShadowLevel } from "../ui/tokens";

const DARK = {
  statusFill: "rgba(40,38,39,0.96)",
  statusBorder: "rgba(255,255,255,0.12)",
  statusText: "#FFFFFFD9",
  crashedBackground: "#1C1A1B",
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
  frozenWash: "rgba(255,255,255,0.4)",
  swipeChevron: "#000000D9",
  swipeRim: "rgba(0,0,0,0.125)",
  swipeSelection: "rgba(0,0,0,0.1)",
};

export type WindowColors = typeof DARK;

export const windowColors = (dark: boolean): WindowColors => (dark ? DARK : LIGHT);

export const SWIPE_CONFIRMED_WASH = "rgba(255,255,255,0.4)";

export const DEV_ERROR = { background: "#1b1416", text: "#ff8a8a", ...font.body, fontFamily: "Menlo" } as const;

export const SAD_TAB_TITLE_SIZE = font.large.fontSize;

export const NATIVE_SKEW_PAD_TOP = 48;

export const SHADOWS = {
  status: { color: ink.black, opacity: { dark: 0.3, light: 0.1 }, radius: 6, offset: [0, 2] },
  sidebarPeek: shadow.peek,
  swipe: { color: ink.black, opacity: { dark: 0.25, light: 0.2 }, radius: 8, offset: [0, 2] },
} satisfies Record<string, ShadowLevel>;

export const STATUS_MOTION = {
  show: { duration: duration.fast, easing: curve.enter },
  hide: { duration: duration.slow, easing: curve.exit, delay: 180 },
} as const;

export const CLI_PILL_MOTION = {
  show: { duration: duration.base, easing: curve.enter },
  hide: { duration: duration.base, easing: curve.exit },
} as const;

export const SWIPE_MOTION = {
  confirm: { duration: duration.base, easing: curve.fade },
  list: { duration: duration.slow, easing: curve.fade },
  dismiss: { duration: duration.base, easing: curve.exit },
} as const;

export const SWIPE_PILL_SPRING = { response: 0.27, damping: 0.9 } as const;

export const DOCK_SPRING = { response: 0.215, damping: 0.79 } as const;

export const ARC_PEEK_SPRING = { response: 0.185, damping: 0.77 } as const;
export const ARC_PEEK_OUT_MS = 150;
export const ARC_HIDE_MS = duration.fast;

export const PEEK_RADIUS = radius.panel;
