import { recentTabSuggestions, type Suggestion } from "@ardia/core";
import { useMemo } from "react";
import { useSettings, useTab, useWindow } from "../../state/browser/hooks";
import { useHistory } from "../../state/history/hooks";
import { usePeeks } from "../../state/peek/hooks";
import { useTabs } from "../../state/tabs/hooks";
import { openTabsByUse } from "../../state/tabs/tabShare";
import type { HistoryEntry } from "../../state/browser/types";
import { tabTitle } from "../../state/sidebar/actions";

const NO_HISTORY: HistoryEntry[] = [];
const RECENT = 4;
const pageKey = (url: string) => url.replace(/#.*$/, "");

export function useDropdownStart(enabled: boolean, tabId: string, profileId: string): Suggestion[] {
  const url = useTab(tabId, (t) => (enabled ? (t?.url ?? "") : ""));
  const title = useTab(tabId, (t) => (enabled ? (t?.title ?? "") : ""));
  const favicon = useTab(tabId, (t) => (enabled ? (t?.favicon ?? null) : null));
  const history = useHistory((h) => (enabled ? (h[profileId] ?? NO_HISTORY) : NO_HISTORY));
  const recent = useMemo(() => {
    const seen = new Set(url ? [pageKey(url)] : []);
    const out: Suggestion[] = [];
    for (const h of [...history].sort((a, b) => b.lastVisit - a.lastVisit)) {
      const key = pageKey(h.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "page", url: h.url, title: h.title, favicon: h.favicon, visited: true });
      if (out.length === RECENT) break;
    }
    return out;
  }, [history, url]);
  return useMemo(() => (url ? [{ kind: "page" as const, url, title, favicon }, ...recent] : recent), [url, title, favicon, recent]);
}

const NO_TABS: Suggestion[] = [];

export function useOpenTabsStart(enabled: boolean, windowId: string, profileId: string): Suggestion[] {
  const tabs = useTabs((all) => (enabled ? all : null));
  const peeks = usePeeks((all) => (enabled ? all : null));
  const shared = useSettings((st) => !!st.shareTabsAcrossWindows);
  const active = useWindow(windowId, (w) => (enabled ? w?.activeTabIds[profileId] : undefined));
  return useMemo(() => {
    if (!tabs || !peeks) return NO_TABS;
    const rows = openTabsByUse(tabs, peeks, { profileId, windowId, shared }).map(({ tab: t, lastActiveAt }) => ({ id: t.id, url: t.url, title: tabTitle(t), favicon: t.favicon, lastActiveAt }));
    return recentTabSuggestions(rows, { exclude: active });
  }, [tabs, peeks, active, profileId, shared, windowId]);
}
