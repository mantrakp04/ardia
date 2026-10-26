import { useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { activeTabId, wake } from "../browser/model";
import type { SplitView, Tab } from "../browser/types";
import { tabEngine } from "../engines/engines";
import { holderOf } from "../pins/pinShare";
import { splitOf } from "../splits/splits";
import { needsPage } from "../tabs/pageSession";
import { pageOf, patchPage } from "../tabs/pageState";
import { wantsPage } from "../tabs/tabPages";
import { removeTabs } from "../tabs/tabs";
import { isSmallWindow } from "./small";
import type { PagerPage } from "./profilePager";

export const useSplitOf = (tabId: string | undefined) => useBrowser((s) => splitOf(s, tabId));

export const useIsSmallWindow = (windowId: string) => useBrowser((s) => isSmallWindow(s.windows[windowId]));

export const useTabEngine = (tabId: string) => useBrowser((s) => tabEngine(s, tabId));

export const currentTabEngine = (tabId: string) => tabEngine(useBrowser.getState(), tabId);

export function useMountedTabIds(windowId: string): string[] {
  const mountedMemo = useRef<{ tabIds?: string[]; tabs?: object; ids: string[]; seen: (Tab | undefined)[]; wants: boolean[] }>({ ids: [], seen: [], wants: [] });
  return useBrowser(
    useShallow((s) => {
      const tabIds = s.windows[windowId]?.tabIds;
      const memo = mountedMemo.current;
      if (memo.tabIds === tabIds && memo.tabs === s.tabs) return memo.ids;
      if (tabIds && memo.tabIds === tabIds) {
        let same = true;
        const seen = memo.seen.slice();
        const wants = memo.wants.slice();
        for (let i = 0; i < tabIds.length; i++) {
          const t = s.tabs[tabIds[i]!];
          if (t === seen[i]) continue;
          seen[i] = t;
          const want = wantsPage(t);
          if (want !== wants[i]) same = false;
          wants[i] = want;
        }
        if (same) {
          mountedMemo.current = { ...memo, tabs: s.tabs, seen, wants };
          return memo.ids;
        }
      }
      const seen = (tabIds ?? []).map((id) => s.tabs[id]);
      const wants = seen.map((t) => wantsPage(t));
      const ids = (tabIds ?? []).filter((_, i) => wants[i]);
      mountedMemo.current = { tabIds, tabs: s.tabs, ids, seen, wants };
      return ids;
    }),
  );
}

export function wakePanes(ids: string[]) {
  const s = useBrowser.getState();
  for (const id of ids) {
    const t = s.tabs[id];
    if (!t || !needsPage(t)) continue;
    const holder = holderOf(s, id);
    s.updateTab(id, holder ? { pageIn: holder.id, unloaded: undefined } : wake(t));
  }
}

export function successorWhenLeaving(leaving: string[], windowId: string): string | undefined {
  const s = useBrowser.getState();
  const next = activeTabId(removeTabs(s, leaving, false), windowId);
  return next && next !== activeTabId(s, windowId) ? next : undefined;
}

export const useWarmTabIds = (windowId: string, pagerPages: PagerPage[] | null, successor: string | undefined) =>
  useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const ids = !w || !pagerPages ? [] : pagerPages.map((p) => (p.id === w.profileId ? undefined : w.activeTabIds[p.id])).filter((id): id is string => !!id);
      return successor && s.tabs[successor]?.windowId === windowId && !ids.includes(successor) ? [...ids, successor] : ids;
    }),
  );

export const useSplitsOf = (tabIds: string[]) => useBrowser(useShallow((s) => tabIds.map((id) => splitOf(s, id)).filter((v): v is SplitView => !!v)));

export function useShownPaneKeys(mounted: string[], panes: object): string[] {
  const shownMemo = useRef<{ mounted?: string[]; panes?: object; tabs?: object; keys: string[]; ids: string[]; found: (Tab | undefined)[] }>({ keys: [], ids: [], found: [] });
  return useBrowser(
    useShallow((s) => {
      const memo = shownMemo.current;
      if (memo.mounted === mounted && memo.panes === panes) {
        if (memo.tabs === s.tabs) return memo.keys;
        let same = true;
        let found = memo.found;
        for (let i = 0; i < memo.ids.length && same; i++) {
          const t = s.tabs[memo.ids[i]!];
          const was = found[i];
          if (t === was) continue;
          if (!t || !was || t.createdAt !== was.createdAt || t.profileId !== was.profileId) same = false;
          else {
            if (found === memo.found) found = found.slice();
            found[i] = t;
          }
        }
        if (same) {
          shownMemo.current = { ...memo, tabs: s.tabs, found };
          return memo.keys;
        }
      }
      const ids = [...new Set([...mounted, ...Object.keys(panes)])];
      const found = ids.map((id) => s.tabs[id]);
      const keys = found
        .filter((t): t is Tab => !!t)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((t) => `${t.id}|${t.profileId}`);
      shownMemo.current = { mounted, panes, tabs: s.tabs, keys, ids, found };
      return keys;
    }),
  );
}

export function downloadNavigated(tabId: string, committedUrl: string | null | undefined, skipped: boolean | undefined) {
  const t = useBrowser.getState().tabs[tabId];
  if (!t) return;
  const s = useBrowser.getState();
  useBrowser.getState().updateLive(tabId, { isLoading: false });
  if (committedUrl) {
    if (t.url !== committedUrl) useBrowser.getState().updateTab(tabId, { url: committedUrl });
    return;
  }
  const others = s.windows[t.windowId]?.tabIds.some((id) => id !== tabId && s.tabs[id]?.profileId === t.profileId);
  const opened = !!(t.openerId || t.adoptId) && !pageOf(tabId).wasNewTab;
  if (!skipped && opened && !s.live[tabId]?.canGoBack && others) return useBrowser.getState().closeTab(tabId);
  patchPage(tabId, { backToNewTab: false, newTabShown: null });
  useBrowser.getState().updateTab(tabId, { url: "", title: "", favicon: null });
}

export function activateFocusedPane(tabId: string) {
  const s = useBrowser.getState();
  const t = s.tabs[tabId];
  if (t && splitOf(s, tabId) && s.windows[t.windowId]?.activeTabIds[t.profileId] !== tabId) s.activate(tabId);
}
