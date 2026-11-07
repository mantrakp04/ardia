import { create } from "zustand";
import { CARD_INSET } from "../../lib/windowLayout";
import { compactLift, toolbarRowOf } from "../../lib/toolbarRow";
import type { LightsPlace } from "../../platform/windows";

export const LIGHTS_CENTER: readonly [number, number] = [25, CARD_INSET + 21];
const COMPACT_LIGHTS_CENTER: readonly [number, number] = [LIGHTS_CENTER[0], LIGHTS_CENTER[1] - compactLift(toolbarRowOf(true))];
export const toolbarLightsCenter = (compact: boolean): readonly [number, number] => (compact ? COMPACT_LIGHTS_CENTER : LIGHTS_CENTER);
export const ARC_LIGHTS_CENTER: readonly [number, number] = [25, 24];
export const TOP_STRIP_LIGHTS_CENTER: readonly [number, number] = [20.75, 20.75];

export function lightsCenter(offset: number, down = 0, base: readonly [number, number] = LIGHTS_CENTER): [number, number] {
  const dx = Math.round(offset * 2) / 2;
  return [base[0] - dx, base[1] + down];
}

export function sidebarLightsCenter(right: boolean, width: number, offset: number, down = 0, base: readonly [number, number] = LIGHTS_CENTER): LightsPlace {
  if (!right) return lightsCenter(offset, down, base);
  const [x, y] = lightsCenter(-offset, down, base);
  return [width - x, y, "right"];
}

export type PeekSpan = readonly [from: number, to: number];

type DockMotion = { moving: Record<string, true>; peeks: Record<string, PeekSpan> };
export const useDockMotion = create<DockMotion>()(() => ({ moving: {}, peeks: {} }));

export const dockMoving = (windowId: string) => !!useDockMotion.getState().moving[windowId];

export const whenDockStill = (windowId: string, listener: () => void) =>
  useDockMotion.subscribe((m) => {
    if (!m.moving[windowId]) listener();
  });

export function setDockMoving(windowId: string, moving: boolean) {
  const current = useDockMotion.getState().moving;
  if (!!current[windowId] === moving) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({
    moving: moving ? { ...current, [windowId]: true } : rest,
  });
}

const NO_SPAN: PeekSpan = [-Infinity, 0];

export function setPeekShown(windowId: string, shown: boolean, span: PeekSpan = NO_SPAN) {
  const current = useDockMotion.getState().peeks;
  const was = current[windowId];
  if (shown ? !!was && was[0] === span[0] && was[1] === span[1] : !was) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({ peeks: shown ? { ...current, [windowId]: span } : rest });
}
export const peekShown = (windowId: string) => windowId in useDockMotion.getState().peeks;
export const overPeek = (windowId: string, x: number) => {
  const span = useDockMotion.getState().peeks[windowId];
  return !!span && x >= span[0] && x < span[1];
};
export const usePeekSpan = (windowId: string): PeekSpan | undefined => useDockMotion((m) => m.peeks[windowId]);
export const devPeeks: Record<string, { show(): void; hide(): void }> = {};
