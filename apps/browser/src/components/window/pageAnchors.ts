import { space } from "../ui/tokens";
import type { Rect, ToolbarGeometry } from "./geometry";

const MARGIN = space.m;

export type PageAnchor = { toolbar: ToolbarGeometry | null; sidebarRight: boolean };

export type PageSurface = "prompt" | "siteButton";

export const fitLeft = (want: number, room: number, width: number) => Math.max(MARGIN, Math.min(want, room - width - MARGIN));

const sidebarEdgeWant = (sidebarRight: boolean) => (sidebarRight ? Infinity : -Infinity);

export function pageSurfaceLeft(anchor: PageAnchor, surface: PageSurface, paneWidth: number, width: number): number {
  const want = !anchor.toolbar ? sidebarEdgeWant(anchor.sidebarRight) : surface === "siteButton" ? Infinity : anchor.toolbar.urlLeft;
  return fitLeft(want, paneWidth, width);
}

export function historyMenuLeft(anchor: PageAnchor, underButton: number, paneWidth: number, width: number): number {
  return fitLeft(anchor.toolbar ? underButton : sidebarEdgeWant(anchor.sidebarRight), paneWidth, width);
}

export type PeekSpanLike = readonly [from: number, to: number];

export function besidePeekSpan(peek: PeekSpanLike, cardLeft: number, cardWidth: number, pane: Rect): { left: number; room: number } {
  const peekFromRight = peek[0] !== -Infinity;
  if (peekFromRight) return { left: Infinity, room: Math.min(cardWidth, pane.x + pane.width, peek[0] - cardLeft) };
  return { left: Math.max(pane.x, peek[1] - cardLeft) + MARGIN, room: cardWidth };
}
