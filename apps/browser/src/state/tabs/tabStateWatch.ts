import { changedIds } from "../browser/changes";
import { keyedWatch, useKeyed } from "../browser/keyedWatch";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { tabEngine } from "../engines/engines";
import { shares } from "../pins/pinShare";
import { navigationOf } from "./pageSession";

const wakeIds = (ids: Iterable<string> | undefined, wake: (id: string) => void) => {
  if (ids) for (const id of ids) wake(id);
};

const openerEngine = (t: Tab | undefined) => (t?.engine && (t.url || navigationOf(t)) ? t.engine : undefined);

function reachesOtherTabs(s: BrowserState, prev: BrowserState, id: string): boolean {
  const tab = s.tabs[id];
  const was = prev.tabs[id];
  if (!tab || openerEngine(tab) !== openerEngine(was) || shares(s, tab) || shares(prev, was)) return true;
  return tabEngine(s, id) !== tabEngine(prev, id);
}

const pinnedGroupChanged = (s: BrowserState, prev: BrowserState) =>
  s.groups !== prev.groups && changedIds(s.groups, prev.groups).some((id) => s.groups[id]?.pinned || prev.groups[id]?.pinned);

export const watchTabState = keyedWatch<BrowserState>(() => useBrowser, (s, prev, wake) => {
  const wide = s.settings !== prev.settings || s.profiles !== prev.profiles || s.privateSiteMutes !== prev.privateSiteMutes;
  if (wide || s.splits !== prev.splits || s.peeks !== prev.peeks || pinnedGroupChanged(s, prev)) return true;
  if (s.windows !== prev.windows)
    for (const id of changedIds(s.windows, prev.windows)) {
      const w = s.windows[id];
      const was = prev.windows[id];
      if (w?.kind !== was?.kind) return true;
      if (w?.activeTabIds === was?.activeTabIds) continue;
      wakeIds(w && Object.values(w.activeTabIds), wake);
      wakeIds(was && Object.values(was.activeTabIds), wake);
    }
  if (s.tabs !== prev.tabs)
    for (const id of changedIds(s.tabs, prev.tabs)) {
      if (reachesOtherTabs(s, prev, id)) return true;
      wake(id);
    }
  if (s.live !== prev.live) wakeIds(changedIds(s.live, prev.live), wake);
  if (s.selection !== prev.selection)
    for (const id of changedIds(s.selection, prev.selection)) {
      wakeIds(s.selection[id], wake);
      wakeIds(prev.selection[id], wake);
    }
});

export const useTabState = <T,>(tabId: string | null | undefined, read: (s: BrowserState) => T): T =>
  useKeyed(watchTabState, tabId, () => read(useBrowser.getState()));
