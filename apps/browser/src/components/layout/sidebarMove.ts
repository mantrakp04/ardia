import { create } from "zustand";
import { useBrowser, type BrowserState } from "../../store/browser";
import { sidebarMayDockRight } from "../sidebar/tokens";
import { PEEK_BOTTOM, PEEK_ORIGIN } from "./dockMotion";

export type SidebarSide = "left" | "right";
export type MoveArea = { width: number; height: number };
export type PressRect = { x: number; y: number; width: number; height: number };
type SlabRect = PressRect;

const SIDEBAR_MOVE_THRESHOLD = 4;
const PRESS_RETENTION = { left: 20, right: 20, top: 20, bottom: 30 } as const;
export const SWITCH_LIMIT_MS = 900;

export const sidebarGlyph = (right: boolean) => (right ? "sidebar.right" : "sidebar.left");

export const pastMoveThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) > SIDEBAR_MOVE_THRESHOLD;

export const withinPressRetention = (x: number, y: number, r: PressRect) =>
  x > r.x - PRESS_RETENTION.left && x < r.x + r.width + PRESS_RETENTION.right && y > r.y - PRESS_RETENTION.top && y < r.y + r.height + PRESS_RETENTION.bottom;

export const startsMoveDrag = (g: { dx: number; dy: number; moveX: number; moveY: number }, button: PressRect | null) =>
  pastMoveThreshold(g.dx, g.dy) && !withinPressRetention(g.moveX, g.moveY, button ?? { x: g.moveX - g.dx, y: g.moveY - g.dy, width: 0, height: 0 });

export const sideUnder = (x: number, windowWidth: number): SidebarSide => (x < windowWidth / 2 ? "left" : "right");

export const sidebarSide = (s: BrowserState): SidebarSide => (s.settings.sidebarSide === "right" ? "right" : "left");

export function canMoveSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return !!w && w.kind !== "small" && sidebarMayDockRight(s) && (w.tabLayout ?? s.settings.tabLayout) === "sidebar";
}

export function slabRect(side: SidebarSide, area: MoveArea, sidebarWidth: number): SlabRect {
  const [inset, top] = PEEK_ORIGIN;
  const width = Math.max(0, Math.min(sidebarWidth, area.width / 2) - inset);
  return { x: side === "left" ? inset : area.width - inset - width, y: top, width, height: Math.max(0, area.height - top - PEEK_BOTTOM) };
}

type SidebarMove = { windowId: string | null; x: number; y: number; grab: [number, number]; from: SidebarSide; target: SidebarSide };

const IDLE: SidebarMove = { windowId: null, x: -1, y: -1, grab: [0, 0], from: "left", target: "left" };

export const useSidebarMove = create<SidebarMove>()(() => IDLE);

const areas = new Map<string, MoveArea>();
export function setMoveArea(windowId: string, area: MoveArea | null) {
  if (!area) return void areas.delete(windowId);
  areas.set(windowId, area);
  const move = useSidebarMove.getState();
  if (move.windowId === windowId) useSidebarMove.setState({ target: sideUnder(move.x, area.width) });
}

export function beginSidebarMove(windowId: string, x: number, y: number): boolean {
  const s = useBrowser.getState();
  if (!canMoveSidebar(s, windowId)) return false;
  const area = areas.get(windowId);
  const from = sidebarSide(s);
  useSidebarMove.setState({ windowId, x, y, grab: [0, 0], from, target: area?.width ? sideUnder(x, area.width) : from });
  return true;
}

export function updateSidebarMove(x: number, y: number): boolean {
  const move = useSidebarMove.getState();
  if (!move.windowId) return false;
  const area = areas.get(move.windowId);
  const target = area?.width ? sideUnder(x, area.width) : move.target;
  useSidebarMove.setState({ x, y, target });
  return target !== move.target;
}

export function endSidebarMove(commit: boolean): SidebarSide | null {
  const { windowId, target } = useSidebarMove.getState();
  if (!windowId) return null;
  useSidebarMove.setState(IDLE);
  if (!commit) return null;
  return moveSidebarTo(target) ? target : null;
}

export function moveSidebarTo(side: SidebarSide): boolean {
  const s = useBrowser.getState();
  if (sidebarSide(s) === side) return false;
  s.updateSettings({ sidebarSide: side });
  return true;
}

export function outgoingSide<T>(outFrom: T | null, from: T, { visible, slides }: { visible: boolean; slides: boolean }): T | null {
  return outFrom !== null || !visible || !slides ? outFrom : from;
}

const MOVE_SIDEBAR_ITEMS: Record<SidebarSide, string> = { left: "moveSidebarLeft", right: "moveSidebarRight" };

export function sidebarToggleMenuItems(s: BrowserState, windowId: string): { id: string; title: string; symbol: string }[] {
  if (!canMoveSidebar(s, windowId)) return [];
  const toRight = sidebarSide(s) === "left";
  const id = MOVE_SIDEBAR_ITEMS[toRight ? "right" : "left"];
  return [{ id, title: toRight ? "Move Sidebar Right" : "Move Sidebar Left", symbol: sidebarGlyph(toRight) }];
}

export function chooseSidebarToggleMenuItem(choice: string | null) {
  const side = (Object.keys(MOVE_SIDEBAR_ITEMS) as SidebarSide[]).find((k) => MOVE_SIDEBAR_ITEMS[k] === choice);
  if (side) moveSidebarTo(side);
}

if (__DEV__) Object.assign(globalThis, { acSidebarMove: useSidebarMove, acSidebarMoves: { moveSidebarTo, chooseSidebarToggleMenuItem, sidebarToggleMenuItems } });
