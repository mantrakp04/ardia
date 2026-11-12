import { space } from "../ui/tokens";

export const RESULT_MIN_HEIGHT = 40;
export const RESULT_GAP = 2;
export const RESULTS_TOP = space.xs;
export const RESULTS_BOTTOM = space.l;
export const PREVIEW_DELAY_MS = 140;

export function scrollToShow(rowTop: number, rowHeight: number, offset: number, height: number, first: boolean): number {
  if (first) return 0;
  const above = rowTop - RESULTS_TOP;
  if (above < offset) return Math.max(0, above);
  const below = rowTop + rowHeight + RESULTS_BOTTOM;
  if (height > 0 && below > offset + height) return below - height;
  return offset;
}
