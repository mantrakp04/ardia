import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isAsleep } from "../tabs/pageSession";

const closedAway = (s: BrowserState, prev: BrowserState, tabId: string | undefined) =>
  !!tabId && (!s.tabs[tabId] || (isAsleep(s.tabs[tabId]) && !isAsleep(prev.tabs[tabId])));

export const watchRevealTargets = (windowId: string, found: (switched: string | null, opened: string | null) => void) =>
  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.tabs === prev.tabs) return;
    let switched: string | null = null;
    let opened: string | null = null;
    const active = activeTabId(s, windowId);
    const previous = activeTabId(prev, windowId);
    if (active && active !== previous && !closedAway(s, prev, previous)) switched = active;
    const w = s.windows[windowId];
    const before = prev.windows[windowId];
    if (w && before && w.tabIds !== before.tabIds) {
      const had = new Set(before.tabIds);
      for (const id of w.tabIds) if (!had.has(id) && s.tabs[id]?.openerId && id !== active) opened = id;
    }
    found(switched, opened);
  });
