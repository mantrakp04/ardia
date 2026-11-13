import type { Visit } from "../store/browserDatabase.ts";

export type HistoryRow = { url: string; title: string; favicon: string | null; visits: number; lastVisit: number };

export const SUMMARY_LIMIT = 5000;
export const SUMMARY_SCAN = 20_000;
export const HISTORY_RETENTION_MS = 90 * 24 * 3_600_000;

export function summarizeVisits(newestFirst: readonly Visit[], limit: number): HistoryRow[] {
  const rows = new Map<string, HistoryRow>();
  for (const visit of newestFirst) {
    const row = rows.get(visit.url);
    if (row) {
      row.visits += 1;
      if (!row.title) row.title = visit.title;
    } else if (rows.size < limit) {
      rows.set(visit.url, { url: visit.url, title: visit.title, favicon: null, visits: 1, lastVisit: visit.visitedAt });
    }
  }
  return [...rows.values()];
}
