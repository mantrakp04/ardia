import { springs } from "../ui/motion";
import { font, weight } from "../ui/tokens";

const DARK = {
  rowFill: "rgba(255,255,255,0.16)",
  rowInk: "#FFFFFFE6",
  rowDot: "#FFFFFFCC",
  tileFill: "#55555A",
};

const LIGHT: typeof DARK = {
  rowFill: "rgba(0,0,0,0.11)",
  rowInk: "#000000CC",
  rowDot: "#000000A6",
  tileFill: "#D4D4D8",
};

export const unreadColors = (dark: boolean) => (dark ? DARK : LIGHT);

export const UNREAD_PILL = {
  row: { height: 16, padX: 5, type: font.caption, line: 16, weight: weight.semibold },
  tile: { height: 11, padX: 3, type: font.badge, line: 11, weight: weight.semibold },
} as const;
export const UNREAD_TILE = { inset: 4, dotInset: 5.5 } as const;
export const UNREAD_DOT = 6;
export const UNREAD_INLINE_GAP = 6;

export const unreadMotion = { show: springs.bouncy, hide: springs.snappy, hiddenScale: 0.5 } as const;
