import type { Suggestion } from "./suggest.ts";

export type OpenTabRow = { id: string; url: string; title: string; favicon: string | null; lastActiveAt: number };

export function recentTabSuggestions(tabs: readonly OpenTabRow[], options: { exclude?: string; limit?: number } = {}): Suggestion[] {
  const { exclude, limit = 8 } = options;
  return tabs
    .filter((t) => t.url && t.id !== exclude)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, limit)
    .map((t) => ({ kind: "page", url: t.url, title: t.title, favicon: t.favicon, tabId: t.id }));
}
