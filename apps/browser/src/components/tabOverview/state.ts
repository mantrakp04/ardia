import { Animated } from "react-native";
import { create } from "zustand";
import { expectFocus } from "../../lib/focusClaims";
import { pinchEndsOpen, pinchProgress } from "./gesture";

export const TAB_OVERVIEW_FOCUS = "tabOverview";

type TabOverviewState = { open: Record<string, true> };

export const useTabOverview = create<TabOverviewState>()(() => ({ open: {} }));

const reveals = new Map<string, Animated.Value>();
const settling = new Map<string, Animated.CompositeAnimation>();

export function revealOf(windowId: string): Animated.Value {
  let value = reveals.get(windowId);
  if (!value) reveals.set(windowId, (value = new Animated.Value(0)));
  return value;
}


export function tabOverviewOpen(windowId: string): boolean {
  return !!useTabOverview.getState().open[windowId];
}

function mount(windowId: string) {
  if (tabOverviewOpen(windowId)) return;
  expectFocus(windowId, TAB_OVERVIEW_FOCUS);
  useTabOverview.setState((s) => ({ open: { ...s.open, [windowId]: true } }));
}

function unmount(windowId: string) {
  if (!tabOverviewOpen(windowId)) return;
  useTabOverview.setState((s) => {
    const { [windowId]: _, ...open } = s.open;
    return { open };
  });
}

function settle(windowId: string, open: boolean, velocity = 0) {
  settling.get(windowId)?.stop();
  const anim = Animated.spring(revealOf(windowId), { toValue: open ? 1 : 0, velocity, speed: 16, bounciness: open ? 5 : 0, useNativeDriver: true });
  settling.set(windowId, anim);
  anim.start(({ finished }) => {
    settling.delete(windowId);
    if (finished && !open) unmount(windowId);
  });
}

export function openTabOverview(windowId: string) {
  mount(windowId);
  settle(windowId, true);
}

export function closeTabOverview(windowId: string) {
  if (!tabOverviewOpen(windowId)) return;
  settle(windowId, false);
}

export function toggleTabOverview(windowId: string) {
  if (tabOverviewOpen(windowId) && !settling.has(windowId)) closeTabOverview(windowId);
  else openTabOverview(windowId);
}

const gestures = new Map<string, { startedOpen: boolean; progress: number }>();

export function followPinch(windowId: string, total: number) {
  let g = gestures.get(windowId);
  if (!g) {
    const startedOpen = tabOverviewOpen(windowId);
    if (!startedOpen && total >= 0) return;
    if (startedOpen && total <= 0) return;
    gestures.set(windowId, (g = { startedOpen, progress: startedOpen ? 1 : 0 }));
    settling.get(windowId)?.stop();
    mount(windowId);
  }
  g.progress = pinchProgress(total, g.startedOpen);
  revealOf(windowId).setValue(g.progress);
}

export function endPinch(windowId: string, cancelled: boolean) {
  const g = gestures.get(windowId);
  if (!g) return;
  gestures.delete(windowId);
  const open = cancelled ? g.startedOpen : pinchEndsOpen(g.progress, g.startedOpen);
  if (open) openTabOverview(windowId);
  else settle(windowId, false);
}
