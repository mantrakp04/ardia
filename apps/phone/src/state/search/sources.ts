import type { HistoryRow } from "../history/historySummary.ts";
import type { BrowserTab } from "../tabs/tabModels.ts";

export type SourceTab = { id: string; url: string; title: string; favicon: string | null };

export type Sources = { tabs: SourceTab[]; history: HistoryRow[]; bookmarks: [] };

export const buildSources = (openTabs: readonly BrowserTab[], history: readonly HistoryRow[]): Sources => ({
  tabs: openTabs.filter((tab) => !tab.isPrivate).map((tab) => ({ id: tab.id, url: tab.url, title: tab.title, favicon: tab.faviconUrl })),
  history: [...history],
  bookmarks: [],
});

export const sourcesKey = (listing: number, historyRevision: number) => `${listing}:${historyRevision}`;
