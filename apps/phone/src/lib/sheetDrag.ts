export const SHEET_BACKGROUND_SHRINK = 0.06;
export const SHEET_DISMISS_SHARE = 0.25;
export const SHEET_FLING_DISMISS = 1200;
export const ROW_DELETE_DISTANCE = 56;
export const ROW_DELETE_VELOCITY = 125;

export function sheetProgress(offset: number, height: number): number {
  "worklet";
  if (height <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - offset / height));
}

export function draggedOffset(start: number, translation: number, height: number): number {
  "worklet";
  return Math.min(Math.max(start + translation, 0), Math.max(height, 0));
}

export function sheetDismisses(offset: number, height: number, velocity: number): boolean {
  "worklet";
  return velocity > SHEET_FLING_DISMISS || (velocity >= 0 && offset > height * SHEET_DISMISS_SHARE);
}

export function backgroundScale(progress: number): number {
  "worklet";
  return 1 - SHEET_BACKGROUND_SHRINK * progress;
}

export function rowDeletes(translation: number, velocity: number): boolean {
  "worklet";
  if (velocity <= -ROW_DELETE_VELOCITY) return true;
  if (velocity >= ROW_DELETE_VELOCITY) return false;
  return -translation >= ROW_DELETE_DISTANCE;
}

export function rowOffset(translation: number): number {
  "worklet";
  return Math.min(0, translation);
}
