import { space } from "../ui/tokens";

export const RESULT_HEIGHT = 40;
export const GROUP_HEADER = 26;
export const GROUP_GAP = space.xs;
export const RESULTS_BOTTOM = space.l;

export function scrollToShow(rowTop: number, offset: number, height: number, first: boolean): number {
  if (first) return 0;
  const above = rowTop - GROUP_HEADER - GROUP_GAP;
  if (above < offset) return Math.max(0, above);
  const below = rowTop + RESULT_HEIGHT + RESULTS_BOTTOM;
  if (height > 0 && below > offset + height) return below - height;
  return offset;
}
