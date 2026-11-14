import type { HistoryRow } from "../history/historySummary.ts";
import { searchQuery } from "../page/pageMenu.ts";
import type { BrowserTab } from "../tabs/tabModels.ts";

export type SourceTab = { id: string; url: string; title: string; favicon: string | null };

export type SourceBookmark = { url: string; title: string; favicon: string | null };

export type Sources = { tabs: SourceTab[]; history: HistoryRow[]; bookmarks: SourceBookmark[] };

export const buildSources = (openTabs: readonly BrowserTab[], history: readonly HistoryRow[], bookmarks: readonly SourceBookmark[] = []): Sources => ({
  tabs: openTabs.filter((tab) => !tab.isPrivate).map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, favicon: tab.faviconUrl })),
  history: [...history],
  bookmarks: [...bookmarks],
});

export const RECENT_SEARCH_LIMIT = 3;

export function recentSearches(rows: readonly HistoryRow[], limit = RECENT_SEARCH_LIMIT): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const row of [...rows].sort((a, b) => b.lastVisit - a.lastVisit)) {
    if (queries.length >= limit) break;
    const query = searchQuery(row.url);
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push(query);
  }
  return queries;
}

export const sourcesKey = (listing: number, historyRevision: number, syncRevision = 0) => `${listing}:${historyRevision}:${syncRevision}`;
