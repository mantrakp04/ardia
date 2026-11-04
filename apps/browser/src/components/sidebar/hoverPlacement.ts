import type { SidebarSide } from "../../state/browser/model";
import type { Anchor } from "../../state/sidebar/sidebarUi";

export const HOVER_CARD_GAP = 8;

export type HoverCardFrame = { side: SidebarSide; windowWidth: number };
export type HoverCardAt = { x: number; top: number };

export const sidebarFacingEdge = (anchor: Anchor, side: SidebarSide) => (side === "right" ? anchor.x : anchor.x + anchor.width);

export function hoverCardAt(anchor: Anchor, side: SidebarSide, edge = sidebarFacingEdge(anchor, side)): HoverCardAt {
  return { x: side === "right" ? edge - HOVER_CARD_GAP : edge + HOVER_CARD_GAP, top: Math.max(8, anchor.y - 6) };
}

export function hoverCardBox(at: HoverCardAt, frame: HoverCardFrame): { left: number; top: number } | { right: number; top: number } {
  return frame.side === "right" ? { right: frame.windowWidth - at.x, top: at.top } : { left: at.x, top: at.top };
}

export function playerEdge(anchor: Anchor, sidebarInnerWidth: number, frame: HoverCardFrame): number {
  const facing = sidebarFacingEdge(anchor, frame.side);
  return frame.side === "right" ? Math.min(facing, frame.windowWidth - sidebarInnerWidth) : Math.max(facing, sidebarInnerWidth);
}
