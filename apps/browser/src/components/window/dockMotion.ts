import { layout } from "../ui/theme";

export const DOCK_SPRING = { response: 0.215, damping: 0.79 } as const;

export const ARC_PEEK_SPRING = { response: 0.185, damping: 0.77 } as const;
export const ARC_PEEK_OUT_MS = 150;
export const ARC_HIDE_MS = 100;

export const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
export const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

export function springAt(
  t: number,
  { response, damping }: { response: number; damping: number } = DOCK_SPRING,
): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  const wd = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * t) * (Math.cos(wd * t) + ((damping * omega) / wd) * Math.sin(wd * t));
}

export const PEEK_ORIGIN: readonly [number, number] = [5, 5];
export const PEEK_BOTTOM = 5;
export const PEEK_RADIUS = 12;

export const dockedCardLeft = (sidebarWidth: number) => sidebarWidth + layout.sidebarCardGap;

export const cardLeft = (dock: number, sidebarWidth: number, inset: number) => inset + (dockedCardLeft(sidebarWidth) - inset) * dock;

export const HEADER_TOOLS = { toggleX: 70.75 + 27, pitch: 35, edge: 7, lightsRight: 70.75 + 7 } as const;

export type HeaderButton = "back" | "forward" | "reload";

export function navButtonsFitting(width: number, button = 30, toggle = true): { buttons: HeaderButton[]; step: number } {
  const { toggleX, pitch, edge } = HEADER_TOOLS;
  const span = width - edge - button / 2 - (toggle ? toggleX : toggleX - pitch);
  const count = Math.max(0, Math.min(3, Math.floor(span / button)));
  const buttons: HeaderButton[] = count === 3 ? ["back", "forward", "reload"] : count === 2 ? ["back", "forward"] : count === 1 ? ["back"] : [];
  return { buttons, step: count ? Math.min(pitch, span / count) : pitch };
}

export const PEEK_EDGE_STRIP = 8;
export const PEEK_HOLD_SLACK = 24;

export type DockState = "fullscreen" | "docked" | "peeking" | "hiding" | "away";
export type DockInput = { open: boolean; fullscreen: boolean; moving: boolean; peekLive: boolean };

export function dockState({ open, fullscreen, moving, peekLive }: DockInput): DockState {
  if (fullscreen) return "fullscreen";
  if (open) return "docked";
  if (peekLive) return "peeking";
  return moving ? "hiding" : "away";
}

export const shownAs = (state: DockState) => (state === "peeking" ? "peek" : state === "hiding" ? "away" : state);

export const watchesLeftEdge = (state: DockState, moving: boolean) => (state === "peeking" || state === "away") && !moving;

export const peekHoldWidth = (sidebarWidth: number) => PEEK_ORIGIN[0] + sidebarWidth + PEEK_HOLD_SLACK;

export const inPeekHold = (x: number, y: number, holdWidth: number, holdHeight: number) => x >= 0 && x < holdWidth && y >= 0 && y < holdHeight;

export const leftEdgeWatchWidth = (peeking: boolean, draggingTab: boolean, holdWidth: number) => (peeking ? holdWidth : draggingTab ? PEEK_EDGE_STRIP : 0);

export type DockMove = "jump" | "arcHide" | "spring";

export function dockMove(o: { open: boolean; animated: boolean; arc: boolean; peekOut: boolean }): DockMove {
  if (!o.animated || (o.arc && o.open && o.peekOut)) return "jump";
  return o.arc && !o.open ? "arcHide" : "spring";
}
