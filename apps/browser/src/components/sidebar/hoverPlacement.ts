import type { SidebarSide } from "../../state/browser/model";
import type { Anchor } from "../../state/sidebar/sidebarUi";
import { space } from "../ui/tokens";

export const HOVER_CARD_GAP = 8;
export const HOVER_CARD_PAD = space.ml;
export const HOVER_CARD_HEADER = 18;
const WINDOW_MARGIN = 8;

export type HoverCardFrame = { side: SidebarSide; windowWidth: number; sidebarEdge: number };
export type HoverCardAt = { x: number; top: number };

export function sidebarEdgeOf(side: SidebarSide, windowWidth: number, sidebarWidth: number, peek: readonly [number, number] | undefined): number {
  if (peek) return side === "right" ? peek[0] : peek[1];
  return side === "right" ? windowWidth - sidebarWidth : sidebarWidth;
}

function facingEdge(anchor: Anchor, frame: HoverCardFrame): number {
  return frame.side === "right" ? Math.min(anchor.x, frame.sidebarEdge) : Math.max(anchor.x + anchor.width, frame.sidebarEdge);
}

export function hoverCardAt(anchor: Anchor, frame: HoverCardFrame): HoverCardAt {
  const edge = facingEdge(anchor, frame);
  const headerCenter = anchor.y + anchor.height / 2;
  return {
    x: frame.side === "right" ? edge - HOVER_CARD_GAP : edge + HOVER_CARD_GAP,
    top: Math.max(WINDOW_MARGIN, Math.round(headerCenter - HOVER_CARD_PAD - HOVER_CARD_HEADER / 2)),
  };
}

export function hoverCardBox(at: HoverCardAt, frame: HoverCardFrame): { left: number; top: number } | { right: number; top: number } {
  return frame.side === "right" ? { right: frame.windowWidth - at.x, top: at.top } : { left: at.x, top: at.top };
}
