import { create } from "zustand";
import { hoverHeld } from "../app/transientUi";
import { tabDragging } from "../drag/tabDrag";
import type { Anchor } from "../sidebar/sidebarUi";

export type StripHover = { windowId: string; tabId: string; anchor: Anchor };

export const STRIP_HOVER_DELAY_MS = { show: 500, leave: 160 };

export const useStripHover = create<{ hover: StripHover | null }>()(() => ({ hover: null }));

type Pointed = { windowId: string; tabId: string; measure: () => Promise<Anchor | null> };

let pointed: Pointed | null = null;
let pressedTab: string | null = null;
let ticket = 0;
const timers: { show?: ReturnType<typeof setTimeout>; leave?: ReturnType<typeof setTimeout> } = {};

const stop = () => {
  clearTimeout(timers.show);
  clearTimeout(timers.leave);
};

const hide = () => {
  if (useStripHover.getState().hover) useStripHover.setState({ hover: null });
};

async function show(target: Pointed, mine: number) {
  const anchor = await target.measure();
  if (mine !== ticket || pointed !== target || !anchor || tabDragging() || hoverHeld(target.windowId)) return;
  useStripHover.setState({ hover: { windowId: target.windowId, tabId: target.tabId, anchor } });
}

export function stripChipEntered(windowId: string, tabId: string, measure: () => Promise<Anchor | null>) {
  stop();
  const target = { windowId, tabId, measure };
  pointed = target;
  if (pressedTab === tabId) return;
  pressedTab = null;
  const mine = ++ticket;
  const current = useStripHover.getState().hover;
  if (current?.windowId === windowId) void show(target, mine);
  else timers.show = setTimeout(() => void show(target, mine), STRIP_HOVER_DELAY_MS.show);
}

export function stripChipLeft(windowId: string, tabId: string) {
  if (pointed?.windowId !== windowId || pointed.tabId !== tabId) return;
  pointed = null;
  pressedTab = null;
  ticket++;
  stop();
  timers.leave = setTimeout(hide, STRIP_HOVER_DELAY_MS.leave);
}

export function stripChipPressed(tabId: string) {
  pressedTab = tabId;
  dismissStripHover();
}

export function dismissStripHover() {
  ticket++;
  stop();
  hide();
}

export function dismissStripHoverIn(windowId: string) {
  if (pointed?.windowId === windowId || useStripHover.getState().hover?.windowId === windowId) dismissStripHover();
}

export function stripChipGone(windowId: string, tabId: string) {
  if (pointed?.windowId === windowId && pointed.tabId === tabId) pointed = null;
  const hover = useStripHover.getState().hover;
  if (hover?.windowId === windowId && hover.tabId === tabId) dismissStripHover();
}
