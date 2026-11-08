import type { SidebarSide } from "../../state/browser/model";
import type { Anchor } from "../../state/sidebar/sidebarUi";

export const HOVER_CARD_GAP = 8;

export type HoverCardFrame = { side: SidebarSide; windowWidth: number; sidebarInnerWidth: number };
export type HoverCardAt = { x: number; top: number };

export function sidebarFacingEdge(anchor: Anchor, frame: HoverCardFrame): number {
  return frame.side === "right"
    ? Math.min(anchor.x, frame.windowWidth - frame.sidebarInnerWidth)
    : Math.max(anchor.x + anchor.width, frame.sidebarInnerWidth);
}

export function hoverCardAt(anchor: Anchor, frame: HoverCardFrame): HoverCardAt {
  const edge = sidebarFacingEdge(anchor, frame);
  return { x: frame.side === "right" ? edge - HOVER_CARD_GAP : edge + HOVER_CARD_GAP, top: Math.max(8, anchor.y - 6) };
}

export function hoverCardBox(at: HoverCardAt, frame: HoverCardFrame): { left: number; top: number } | { right: number; top: number } {
  return frame.side === "right" ? { right: frame.windowWidth - at.x, top: at.top } : { left: at.x, top: at.top };
}
