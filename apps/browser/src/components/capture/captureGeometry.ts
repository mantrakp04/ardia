import type { Rect } from "../layout/geometry";

export const MIN_CAPTURE = 4;

export type Point = { x: number; y: number };

export function dragRect(from: Point, to: Point, bounds: { width: number; height: number }): Rect {
  const clampX = (x: number) => Math.min(bounds.width, Math.max(0, x));
  const clampY = (y: number) => Math.min(bounds.height, Math.max(0, y));
  const [x1, x2] = [clampX(from.x), clampX(to.x)].sort((a, b) => a - b);
  const [y1, y2] = [clampY(from.y), clampY(to.y)].sort((a, b) => a - b);
  return { x: x1!, y: y1!, width: x2! - x1!, height: y2! - y1! };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function paneUnder(selection: Rect, panes: Record<string, Rect>): { tabId: string; rect: Rect } | null {
  let best: { tabId: string; rect: Rect; area: number } | null = null;
  for (const [tabId, pane] of Object.entries(panes)) {
    const rect = intersect(selection, pane);
    const area = rect ? rect.width * rect.height : 0;
    if (rect && (!best || area > best.area)) best = { tabId, rect, area };
  }
  return best && best.rect.width >= MIN_CAPTURE && best.rect.height >= MIN_CAPTURE ? { tabId: best.tabId, rect: best.rect } : null;
}
