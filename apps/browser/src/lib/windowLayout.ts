export const DEFAULT_SIDEBAR_WIDTH = 190;

export const CARD_INSET = 9;

export const PAGE_FRAME = { min: 0, max: 12, default: CARD_INSET } as const;

const SPLIT_MIN_GAP = 2;
const PEEK_EDGE = 5;

const halfPoint = (v: number) => Math.round(v * 2) / 2;

export const validPageFrame = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= PAGE_FRAME.min && v <= PAGE_FRAME.max;

export type PageFrame = {
  inset: number;
  radius: number;
  splitGap: number;
  peek: { left: number; top: number; bottom: number; radius: number };
};

export function pageFrameOf(inset: number, fullRadius: number, peekRadius: number): PageFrame {
  const radius = halfPoint(fullRadius * Math.min(1, inset / CARD_INSET));
  const peekLeft = Math.min(PEEK_EDGE, inset);
  return {
    inset,
    radius,
    splitGap: Math.max(inset, SPLIT_MIN_GAP),
    peek: { left: peekLeft, top: inset, bottom: inset, radius: Math.min(peekRadius, radius + inset - peekLeft) },
  };
}
