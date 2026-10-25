export const PINCH_SPAN = 0.45;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function pinchProgress(total: number, startedOpen: boolean): number {
  return startedOpen ? clamp01(1 - Math.max(0, total) / PINCH_SPAN) : clamp01(-total / PINCH_SPAN);
}

export function pinchEndsOpen(progress: number, startedOpen: boolean): boolean {
  return startedOpen ? progress > 0.6 : progress > 0.35;
}
