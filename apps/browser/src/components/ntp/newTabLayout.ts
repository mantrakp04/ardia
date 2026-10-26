export const DIA_OFFSET = 1;
export const MARK_ABOVE_BAR = 84.1;
export const HEADING_GAP_ABOVE_MARK = 12;
export const HEADING_EDGE = 16;

const CENTRE_LIFT = 158;
const MIN_CENTRED_TOP = 100;
const BAR_DROP = 38;

export function newTabBarTop(height: number, under: number, headingHeight = 0): number {
  const centred = Math.max((height - under) / 2 - CENTRE_LIFT, MIN_CENTRED_TOP) + BAR_DROP + DIA_OFFSET + under;
  return Math.max(centred, under + headingTopReserve(headingHeight));
}

export function headingTopReserve(headingHeight: number): number {
  return headingHeight ? HEADING_EDGE + headingHeight + HEADING_GAP_ABOVE_MARK + MARK_ABOVE_BAR : 0;
}

export function headingTop(barTop: number, headingHeight: number): number {
  return barTop - MARK_ABOVE_BAR - HEADING_GAP_ABOVE_MARK - headingHeight;
}
