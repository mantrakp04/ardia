const CELL = 12;
const MIN_CELL = 8;

export function profileDotCell(count: number, maxWidth?: number): number {
  if (!maxWidth || count < 1) return CELL;
  return Math.max(MIN_CELL, Math.min(CELL, maxWidth / count));
}
