import { create } from "zustand";
import { activeTabId } from "../browser/model";
import { useBrowser, type BrowserState } from "../browser/store";
import { notePageOverlay } from "../telemetry/usage";

export type NewTabNotice = { id: number; tabId: string; sourceId: string };

export const useNewTabNotices = create<{ notices: Record<string, NewTabNotice | null> }>()(() => ({ notices: {} }));

const NEW_TAB_NOTICE_MS = 3500;

let noticeSeq = 0;

export function noteBackgroundTab(windowId: string, tabId: string, sourceId: string | undefined) {
  if (!tabId || !sourceId || useBrowser.getState().tabs[tabId]?.windowId !== windowId) return;
  const notice = { id: ++noticeSeq, tabId, sourceId };
  useNewTabNotices.setState((s) => ({ notices: { ...s.notices, [windowId]: notice } }));
  stopWatchingNoticedTabs ??= useBrowser.subscribe(clearNoticesOfGoneOrShownTabs);
  scheduleHide(windowId, notice.id);
  notePageOverlay("newTabShown");
}

const hideTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleHide(windowId: string, id: number) {
  clearTimeout(hideTimers.get(windowId));
  hideTimers.set(windowId, setTimeout(() => clearNewTabNotice(windowId, id), NEW_TAB_NOTICE_MS));
}

export function holdNewTabNotice(windowId: string, notice: NewTabNotice, held: boolean) {
  if (useNewTabNotices.getState().notices[windowId]?.id !== notice.id) return;
  if (held) clearTimeout(hideTimers.get(windowId));
  else scheduleHide(windowId, notice.id);
}

export function clearNewTabNotice(windowId: string, id: number) {
  useNewTabNotices.setState((s) => (s.notices[windowId]?.id === id ? { notices: { ...s.notices, [windowId]: null } } : s));
  if (Object.values(useNewTabNotices.getState().notices).some(Boolean)) return;
  stopWatchingNoticedTabs?.();
  stopWatchingNoticedTabs = null;
}

export function goToNoticedTab(windowId: string, notice: NewTabNotice) {
  clearNewTabNotice(windowId, notice.id);
  notePageOverlay("newTabPressed");
  if (useBrowser.getState().tabs[notice.tabId]) useBrowser.getState().activate(notice.tabId);
}

export function usePaneNewTabNotice(windowId: string, sourceId: string): NewTabNotice | null {
  return useNewTabNotices((s) => {
    const n = s.notices[windowId];
    return n && n.sourceId === sourceId ? n : null;
  });
}

let stopWatchingNoticedTabs: (() => void) | null = null;

function clearNoticesOfGoneOrShownTabs(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs && s.windows === prev.windows) return;
  const { notices } = useNewTabNotices.getState();
  for (const [windowId, notice] of Object.entries(notices)) {
    if (notice && (!s.tabs[notice.tabId] || activeTabId(s, windowId) === notice.tabId)) clearNewTabNotice(windowId, notice.id);
  }
}
