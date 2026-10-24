import { create } from "zustand";

export const DOCK_SPRING = { response: 0.215, damping: 0.79 } as const;

export const ARC_PEEK_SPRING = { response: 0.185, damping: 0.77 } as const;
export const ARC_PEEK_OUT_MS = 150;
export const ARC_HIDE_MS = 100;

export const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
export const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

export function springConfig({ response, damping }: { response: number; damping: number }) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega, mass: 1 };
}

export function springAt(
  t: number,
  { response, damping }: { response: number; damping: number } = DOCK_SPRING,
): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  const wd = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * t) * (Math.cos(wd * t) + ((damping * omega) / wd) * Math.sin(wd * t));
}

export const LIGHTS_CENTER: readonly [number, number] = [25, 27];
export const ARC_LIGHTS_CENTER: readonly [number, number] = [25, 24];
export const TOP_STRIP_LIGHTS_CENTER: readonly [number, number] = [20.75, 20.75];

export const PEEK_ORIGIN: readonly [number, number] = [5, 5];
export const PEEK_BOTTOM = 5;
export const PEEK_RADIUS = 12;

export function lightsCenter(offset: number, down = 0, base: readonly [number, number] = LIGHTS_CENTER): [number, number] | null {
  const dx = Math.round(offset * 2) / 2;
  return dx === 0 && down === 0 && base === LIGHTS_CENTER ? null : [base[0] - dx, base[1] + down];
}

export const cardLeft = (dock: number, width: number, inset: number) => inset + (width - inset) * dock;

type DockMotion = { moving: Record<string, true>; peeks: Record<string, readonly [number, number]> };
export const useDockMotion = create<DockMotion>()(() => ({ moving: {}, peeks: {} }));

export const dockMoving = (windowId: string) => !!useDockMotion.getState().moving[windowId];

export function setDockMoving(windowId: string, moving: boolean) {
  const current = useDockMotion.getState().moving;
  if (!!current[windowId] === moving) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({
    moving: moving ? { ...current, [windowId]: true } : rest,
  });
}

export function setPeekShown(windowId: string, shown: boolean, rightEdge = 0, leftEdge = -Infinity) {
  const current = useDockMotion.getState().peeks;
  const span = current[windowId];
  if (shown ? span?.[0] === leftEdge && span[1] === rightEdge : !span) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({ peeks: shown ? { ...current, [windowId]: [leftEdge, rightEdge] } : rest });
}
export const peekShown = (windowId: string) => windowId in useDockMotion.getState().peeks;
export const overPeek = (windowId: string, x: number) => {
  const span = useDockMotion.getState().peeks[windowId];
  return !!span && x >= span[0] && x < span[1];
};
export const usePeekEdge = (windowId: string): number | undefined =>
  useDockMotion((m) => (m.peeks[windowId]?.[0] === -Infinity ? m.peeks[windowId]![1] : undefined));
export const usePeekStart = (windowId: string): number | undefined =>
  useDockMotion((m) => (m.peeks[windowId]?.[1] === Infinity ? m.peeks[windowId]![0] : undefined));
export const devPeeks: Record<string, { show(): void; hide(): void }> = {};

export const HEADER_TOOLS = { toggleX: 70.75 + 27, pitch: 35, edge: 7, lightsRight: 70.75 + 7 } as const;

export const HEADER_MIN_GAP = 2;

export type HeaderButton = "back" | "forward" | "reload";

export function navButtonsFitting(width: number, button = 30, toggle = true, toggleX = HEADER_TOOLS.toggleX): { buttons: HeaderButton[]; step: number } {
  const { pitch, edge } = HEADER_TOOLS;
  const span = width - edge - button / 2 - (toggle ? toggleX : toggleX - pitch);
  const count = Math.max(0, Math.min(3, Math.floor(span / (button + HEADER_MIN_GAP))));
  const buttons: HeaderButton[] = count === 3 ? ["back", "forward", "reload"] : count === 2 ? ["back", "forward"] : count === 1 ? ["back"] : [];
  return { buttons, step: count ? Math.min(pitch, span / count) : pitch };
}
