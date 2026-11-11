export const DEFAULT_SIDEBAR_WIDTH = 190;

export const CARD_INSET = 9;

export const PAGE_FRAME = { min: 0, max: 12, default: CARD_INSET } as const;

const SPLIT_MIN_GAP = 2;
const MIN_PEEK_GAP = 4;

export const validPageFrame = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= PAGE_FRAME.min && v <= PAGE_FRAME.max;

export function pageFrameInsetOf(
  inset: number,
  opts: { zeroInFullScreen: boolean; fullScreen: boolean; zeroWhenTabsHidden: boolean; tabsHidden: boolean },
): number {
  if (opts.fullScreen && opts.zeroInFullScreen) return 0;
  if (opts.tabsHidden && opts.zeroWhenTabsHidden) return 0;
  return inset;
}

export type PageFrame = {
  inset: number;
  radius: number;
  splitGap: number;
  peek: { left: number; top: number; bottom: number; radius: number };
};

export function pageFrameOf(inset: number, windowRadius: number, peekRadius: number): PageFrame {
  const radius = Math.max(windowRadius - inset, 2);
  const peekGap = Math.max(MIN_PEEK_GAP, inset);
  return {
    inset,
    radius,
    splitGap: Math.max(inset, SPLIT_MIN_GAP),
    peek: { left: peekGap, top: peekGap, bottom: peekGap, radius: Math.min(peekRadius, radius + inset - peekGap) },
  };
}
