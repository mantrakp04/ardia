type Frames = Record<string, { x: number; width: number }>;
type Options = { gap?: number; shrink?: boolean; unmeasuredVisible?: boolean; overflowing?: boolean };

export function barLayout(ids: string[], frames: Frames, maxWidth: number, overflowWidth: number, options: Options = {}) {
  const { gap = 0, shrink = false, unmeasuredVisible = false } = options;
  const last = frames[ids.at(-1) ?? ""];
  const total = last ? last.x + last.width + gap : maxWidth;
  const width = shrink ? Math.max(0, Math.min(total, maxWidth)) : maxWidth;
  const overflowing = options.overflowing || total > width;
  const visible = ids.filter((id) => {
    const frame = frames[id];
    return frame ? frame.x + frame.width <= width - (overflowing ? overflowWidth : 0) : unmeasuredVisible;
  });
  return { width, overflowing, visible };
}

export function barCandidates<T>(items: T[], maxWidth: number, minWidth: number) {
  return items.slice(0, Math.max(0, Math.floor(maxWidth / minWidth)) + 1);
}
