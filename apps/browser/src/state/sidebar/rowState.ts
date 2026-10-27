import { useBrowser, type BrowserState } from "../browser/store";
import { useTab } from "../browser/hooks";
import { activeTabId } from "../browser/model";
import type { Tab } from "../browser/types";
import { engineMark, type PageEngine } from "../engines/engines";
import { isPageUnloaded } from "../pins/pinShare";
import { useBrowserWhile } from "../tabs/tabWatch";

export const ACTIVE = 1;
export const SELECTED = 2;
export const PLAYING = 4;
export const LOADING = 8;
export const FADED = 16;
const ENGINE_MARKS: Record<PageEngine, number> = { chromium: 32, webkit: 64 };
export const ICON_MARKS = FADED | ENGINE_MARKS.chromium | ENGINE_MARKS.webkit;

export function iconMarks(s: BrowserState, tabId: string): number {
  const faded = s.settings.fadeUnloadedTabs && isPageUnloaded(s, tabId) ? FADED : 0;
  const mark = engineMark(s, tabId);
  return mark ? faded | ENGINE_MARKS[mark] : faded;
}

export const markedEngine = (marks: number): PageEngine | null =>
  marks & ENGINE_MARKS.webkit ? "webkit" : marks & ENGINE_MARKS.chromium ? "chromium" : null;

export const useIconMarks = (tabId: string | undefined, given: number | undefined): number =>
  useBrowserWhile(given === undefined && !!tabId, (s) => given ?? (tabId ? iconMarks(s, tabId) : 0));

function rowFlags(s: BrowserState, windowId: string, tabId: string): number {
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  let flags = iconMarks(s, tabId);
  if (tab && activeTabId(s, tab.windowId, tab.profileId) === tabId) flags |= ACTIVE;
  if (s.selection[windowId]?.includes(tabId)) flags |= SELECTED;
  if (live?.playingAudio) flags |= PLAYING;
  if (live?.isLoading) flags |= LOADING;
  return flags;
}

export function useRowState(tabId: string, windowId: string): { tab: Tab | undefined; flags: number } {
  const tab = useTab(tabId);
  const flags = useBrowser((s) => rowFlags(s, windowId, tabId));
  return { tab, flags };
}
