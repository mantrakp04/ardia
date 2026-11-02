import { create } from "zustand";
import { popoverOf, setPopover } from "../tabs/pageState";

const CLOSE_AFTER_MS = 1500;

type Store = { shown: Record<string, true> };

const useZoomBubbles = create<Store>()(() => ({ shown: {} }));

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const hovered = new Set<string>();

export const useIsZoomBubble = (tabId: string) => useZoomBubbles((s) => !!s.shown[tabId]);

export const isZoomBubble = (tabId: string) => !!useZoomBubbles.getState().shown[tabId];

function markShown(tabId: string, shown: boolean) {
  useZoomBubbles.setState((s) => {
    if (!!s.shown[tabId] === shown) return s;
    const next = { ...s.shown };
    if (shown) next[tabId] = true;
    else delete next[tabId];
    return { shown: next };
  });
}

function stopTimer(tabId: string) {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
}

function startTimer(tabId: string) {
  stopTimer(tabId);
  if (hovered.has(tabId)) return;
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      closeZoomBubble(tabId);
    }, CLOSE_AFTER_MS),
  );
}

function closeZoomBubble(tabId: string) {
  if (!isZoomBubble(tabId)) return;
  if (popoverOf(tabId) === "zoom") setPopover(tabId, null);
  markShown(tabId, false);
}

export function zoomChangedByUser(tabId: string) {
  const open = popoverOf(tabId) ?? null;
  if (open !== null && (open !== "zoom" || !isZoomBubble(tabId))) return;
  markShown(tabId, true);
  if (open !== "zoom") setPopover(tabId, "zoom");
  startTimer(tabId);
}

export function toggleZoomPopover(tabId: string) {
  const bubble = isZoomBubble(tabId);
  stopTimer(tabId);
  markShown(tabId, false);
  setPopover(tabId, popoverOf(tabId) === "zoom" && !bubble ? null : "zoom");
}

export function dismissZoomPopover(tabId: string) {
  stopTimer(tabId);
  markShown(tabId, false);
  if (popoverOf(tabId) === "zoom") setPopover(tabId, null);
}

export function hoverZoomPopover(tabId: string, over: boolean) {
  if (over) {
    hovered.add(tabId);
    stopTimer(tabId);
    return;
  }
  hovered.delete(tabId);
  if (isZoomBubble(tabId)) startTimer(tabId);
}
