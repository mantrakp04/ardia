export type ScrollWatch = { lastSeen: number | null; lastSaved: number | null };

export const SCROLL_MOVE_THRESHOLD = 2;

export function scrollSaveDecision(watch: ScrollWatch, y: number): { save: boolean; next: ScrollWatch } {
  const moving = watch.lastSeen === null || Math.abs(y - watch.lastSeen) > SCROLL_MOVE_THRESHOLD;
  const changed = watch.lastSaved === null || Math.abs(y - watch.lastSaved) > SCROLL_MOVE_THRESHOLD;
  const save = !moving && changed;
  return { save, next: { lastSeen: y, lastSaved: save ? y : watch.lastSaved } };
}
