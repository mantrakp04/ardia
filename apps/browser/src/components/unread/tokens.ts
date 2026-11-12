import { springs } from "../ui/motion";
import { font, weight } from "../ui/tokens";

const DARK = {
  rowFill: "rgba(255,255,255,0.16)",
  rowInk: "#FFFFFFE6",
  rowDot: "#FFFFFFCC",
  cornerFill: "#F2F2F3",
  cornerInk: "#1C1C1E",
  cornerRing: "rgba(0,0,0,0.45)",
};

const LIGHT: typeof DARK = {
  rowFill: "rgba(0,0,0,0.11)",
  rowInk: "#000000CC",
  rowDot: "#000000A6",
  cornerFill: "#1C1C1E",
  cornerInk: "#FFFFFF",
  cornerRing: "rgba(255,255,255,0.9)",
};

export const unreadColors = (dark: boolean) => (dark ? DARK : LIGHT);

export const UNREAD_PILL = {
  row: { height: 16, padX: 5, type: font.caption, line: 16, weight: weight.semibold, nudge: 0 },
  corner: { height: 14, padX: 4, type: font.tiny, line: 14, weight: weight.semibold, nudge: 0 },
} as const;

export const UNREAD_CORNER = { ring: 1.5, top: -10, centerFromIconRight: 1, span: 64 } as const;
export const UNREAD_DOT = { row: 6, corner: 8, cornerTop: -2, cornerRight: -2 } as const;
export const UNREAD_INLINE_GAP = 6;

export const unreadMotion = { show: springs.bouncy, hide: springs.snappy, hiddenScale: 0.5 } as const;
