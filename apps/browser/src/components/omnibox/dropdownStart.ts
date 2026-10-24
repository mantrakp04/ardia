import { recentTabSuggestions, type Suggestion } from "@ardia/core";
import { useMemo } from "react";
import { useBrowser } from "../../store/browser";
import { openTabsByUse } from "../../store/tabShare";
import type { HistoryEntry } from "../../store/types";
import { tabTitle } from "../sidebar/actions";

const NO_HISTORY: HistoryEntry[] = [];
const RECENT = 4;
const pageKey = (url: string) => url.replace(/#.*$/, "");

export function useDropdownStart(enabled: boolean, tabId: string, profileId: string): Suggestion[] {
  const url = useBrowser((s) => (enabled ? (s.tabs[tabId]?.url ?? "") : ""));
  const title = useBrowser((s) => (enabled ? (s.tabs[tabId]?.title ?? "") : ""));
  const favicon = useBrowser((s) => (enabled ? (s.tabs[tabId]?.favicon ?? null) : null));
  const history = useBrowser((s) => (enabled ? (s.history[profileId] ?? NO_HISTORY) : NO_HISTORY));
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
  const tabs = useBrowser((s) => (enabled ? s.tabs : null));
  const peeks = useBrowser((s) => (enabled ? s.peeks : null));
  const shared = useBrowser((s) => !!s.settings.shareTabsAcrossWindows);
  const active = useBrowser((s) => (enabled ? s.windows[windowId]?.activeTabIds[profileId] : undefined));
  return useMemo(() => {
    if (!tabs || !peeks) return NO_TABS;
    const rows = openTabsByUse(tabs, peeks, { profileId, windowId, shared }).map(({ tab: t, lastActiveAt }) => ({ id: t.id, url: t.url, title: tabTitle(t), favicon: t.favicon, lastActiveAt }));
    return recentTabSuggestions(rows, { exclude: active });
  }, [tabs, peeks, active, profileId, shared, windowId]);
}
