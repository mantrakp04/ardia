import type { SidebarSide } from "../browser/model";

export type SidebarEdge = { side: SidebarSide; x: number };

export const NO_SIDEBAR_EDGE: SidebarEdge = { side: "left", x: 0 };

export function sidebarEdgeOf(o: { shown: boolean; side: SidebarSide; sidebarWidth: number; windowWidth: number | undefined }): SidebarEdge {
  if (o.side === "left") return { side: "left", x: o.shown ? o.sidebarWidth : 0 };
  return { side: "right", x: o.shown && o.windowWidth ? o.windowWidth - o.sidebarWidth : Infinity };
}

export const overSidebar = (edge: SidebarEdge, x: number) => (edge.side === "right" ? x > edge.x : x < edge.x);
