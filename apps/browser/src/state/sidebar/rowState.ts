import { useBrowser, type BrowserState } from "../browser/store";
import { useTab } from "../browser/hooks";
import { useKeyed } from "../browser/keyedWatch";
import { watchTabState } from "../tabs/tabStateWatch";
import { activeTabId } from "../browser/model";
import type { Tab } from "../browser/types";
import { engineMark, type PageEngine } from "../engines/engines";
import { isPageUnloaded } from "../pins/pinShare";
import { muteState, type MuteState } from "../tabs/mute";

export const ACTIVE = 1;
export const SELECTED = 2;
export const PLAYING = 4;
export const LOADING = 8;
export const FADED = 16;
const TAB_MUTED = 128;
const SITE_MUTED = 256;
const ENGINE_MARKS: Record<PageEngine, number> = { chromium: 32, webkit: 64 };
export const ICON_MARKS = FADED | ENGINE_MARKS.chromium | ENGINE_MARKS.webkit;

export function iconMarks(s: BrowserState, tabId: string): number {
  const faded = s.settings.fadeUnloadedTabs && isPageUnloaded(s, tabId) ? FADED : 0;
  const mark = engineMark(s, tabId);
  return mark ? faded | ENGINE_MARKS[mark] : faded;
}

export const mutedBy = (flags: number): MuteState => (flags & SITE_MUTED ? "site" : flags & TAB_MUTED ? "tab" : null);

export const markedEngine = (marks: number): PageEngine | null =>
  marks & ENGINE_MARKS.webkit ? "webkit" : marks & ENGINE_MARKS.chromium ? "chromium" : null;

export const useIconMarks = (tabId: string | undefined, given: number | undefined): number =>
  useKeyed(watchTabState, given === undefined ? tabId : null, () => given ?? (tabId ? iconMarks(useBrowser.getState(), tabId) : 0));

export function rowFlags(s: BrowserState, windowId: string, tabId: string): number {
  const tab = s.tabs[tabId];
  const live = s.live[tabId];
  let flags = iconMarks(s, tabId);
  if (tab && activeTabId(s, tab.windowId, tab.profileId) === tabId) flags |= ACTIVE;
  if (s.selection[windowId]?.includes(tabId)) flags |= SELECTED;
  if (live?.playingAudio) flags |= PLAYING;
  if (live?.isLoading) flags |= LOADING;
  const mute = tab ? muteState(s, tab) : null;
  if (mute) flags |= mute === "site" ? SITE_MUTED : TAB_MUTED;
  return flags;
}

export function useRowState(tabId: string, windowId: string): { tab: Tab | undefined; flags: number } {
  const tab = useTab(tabId);
  const flags = useKeyed(watchTabState, tabId, () => rowFlags(useBrowser.getState(), windowId, tabId));
  return { tab, flags };
}
