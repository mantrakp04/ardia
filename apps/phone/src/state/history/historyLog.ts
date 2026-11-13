import type { SqlDatabase } from "../../lib/sqlDatabase.ts";
import { isSyncableUrl } from "../tabs/tabModels.ts";
import {
  deleteVisitsBefore,
  deleteVisitsSince,
  insertVisit,
  maxVisitId,
  newestVisits,
  searchVisits,
  updateVisit,
  type Visit,
  type VisitTransition,
} from "../store/browserDatabase.ts";
import { summarizeVisits, SUMMARY_LIMIT, SUMMARY_SCAN, type HistoryRow } from "./historySummary.ts";

export type HistoryLog = {
  revision(): number;
  record(url: string, title: string, transition: VisitTransition, profileSyncId: string | null, at: number): Visit | null;
  amend(visit: Visit, patch: { url?: string; title?: string }): Visit;
  summary(limit?: number, scan?: number): HistoryRow[];
  search(text: string, limit?: number): Visit[];
  pruneBefore(cutoff: number): void;
  clear(since: number | null): void;
};

export function createHistoryLog(db: SqlDatabase): HistoryLog {
  let nextId = maxVisitId(db);
  let revision = 0;
  let cached: { revision: number; limit: number; rows: HistoryRow[] } | null = null;
  const bump = () => {
    revision += 1;
  };
  return {
    revision: () => revision,
    record(url, title, transition, profileSyncId, at) {
      if (!isSyncableUrl(url)) return null;
      nextId += 1;
      const visit: Visit = { id: nextId, url, title, visitedAt: at, profileSyncId, transition };
      insertVisit(db, visit);
      bump();
      return visit;
    },
    amend(visit, patch) {
      const amended: Visit = {
        ...visit,
        url: patch.url && isSyncableUrl(patch.url) ? patch.url : visit.url,
        title: patch.title ? patch.title : visit.title,
      };
      updateVisit(db, amended);
      bump();
      return amended;
    },
    summary(limit = SUMMARY_LIMIT, scan = SUMMARY_SCAN) {
      if (cached && cached.revision === revision && cached.limit === limit) return cached.rows;
      const rows = summarizeVisits(newestVisits(db, scan), limit);
      cached = { revision, limit, rows };
      return rows;
    },
    search(text, limit = 200) {
      const query = text.trim();
      return query ? searchVisits(db, query, limit) : newestVisits(db, limit);
    },
    pruneBefore(cutoff) {
      deleteVisitsBefore(db, cutoff);
      bump();
    },
    clear(since) {
      deleteVisitsSince(db, since);
      bump();
    },
  };
}
