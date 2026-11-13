import { TAB_ORIGINS, type BrowserTab, type TabOrigin } from "../tabs/tabModels.ts";
import type { SqlDatabase, SqlValue } from "../../lib/sqlDatabase.ts";

export type VisitTransition = "typed" | "link" | "backForward" | "formSubmit" | "restored" | "other";

export type Visit = { id: number; url: string; title: string; visitedAt: number; profileSyncId: string | null; transition: VisitTransition };

const TAB_COLUMNS =
  "id, url, title, created, lastActive, archivedAt, position, profileSyncId, faviconUrl, themeColorHex, snapshotFileName, origin, receivedKey, receivedFromDevice";

const VISIT_COLUMNS = "id, url, title, visitedAt, profileSyncId, transition";

type TabRow = Omit<BrowserTab, "isPrivate" | "origin"> & { origin: string };

const originOf = (raw: string): TabOrigin => (TAB_ORIGINS as readonly string[]).includes(raw) ? (raw as TabOrigin) : "typed";

const tabOf = (row: TabRow): BrowserTab => ({ ...row, origin: originOf(row.origin), isPrivate: false });

const tabValues = (tab: BrowserTab): SqlValue[] => [
  tab.id,
  tab.url,
  tab.title,
  tab.created,
  tab.lastActive,
  tab.archivedAt,
  tab.position,
  tab.profileSyncId,
  tab.faviconUrl,
  tab.themeColorHex,
  tab.snapshotFileName,
  tab.origin,
  tab.receivedKey,
  tab.receivedFromDevice,
];

const escapeLike = (text: string) => `%${text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

export const readOpenTabs = (db: SqlDatabase) =>
  db.all<TabRow>(`SELECT ${TAB_COLUMNS} FROM tabs WHERE archivedAt IS NULL ORDER BY position`).map(tabOf);

export const readArchivedTabs = (db: SqlDatabase, limit: number, offset = 0) =>
  db.all<TabRow>(`SELECT ${TAB_COLUMNS} FROM tabs WHERE archivedAt IS NOT NULL ORDER BY archivedAt DESC LIMIT ? OFFSET ?`, [limit, offset]).map(tabOf);

export const searchArchivedTabs = (db: SqlDatabase, text: string, limit: number) => {
  const pattern = escapeLike(text);
  return db
    .all<TabRow>(
      `SELECT ${TAB_COLUMNS} FROM tabs WHERE archivedAt IS NOT NULL AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\') ORDER BY archivedAt DESC LIMIT ?`,
      [pattern, pattern, limit],
    )
    .map(tabOf);
};

export const countArchivedTabs = (db: SqlDatabase) => db.first<{ n: number }>("SELECT count(*) AS n FROM tabs WHERE archivedAt IS NOT NULL")?.n ?? 0;

export function writeTabs(db: SqlDatabase, put: readonly BrowserTab[], remove: readonly string[]) {
  const stored = put.filter((tab) => !tab.isPrivate);
  if (!stored.length && !remove.length) return;
  db.transaction(() => {
    for (const tab of stored) db.run(`INSERT OR REPLACE INTO tabs (${TAB_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, tabValues(tab));
    for (const id of remove) {
      db.run("DELETE FROM tabs WHERE id = ?", [id]);
      db.run("DELETE FROM tab_state WHERE id = ?", [id]);
    }
  });
}

export function deleteArchivedTabs(db: SqlDatabase): string[] {
  let removed: string[] = [];
  db.transaction(() => {
    removed = db.all<{ id: string }>("SELECT id FROM tabs WHERE archivedAt IS NOT NULL").map((r) => r.id);
    db.run("DELETE FROM tab_state WHERE id IN (SELECT id FROM tabs WHERE archivedAt IS NOT NULL)");
    db.run("DELETE FROM tabs WHERE archivedAt IS NOT NULL");
  });
  return removed;
}

export function expiredArchivedIds(db: SqlDatabase, cutoff: number, keep: number): string[] {
  const old = db.all<{ id: string }>("SELECT id FROM tabs WHERE archivedAt IS NOT NULL AND archivedAt < ?", [cutoff]);
  const beyond = db.all<{ id: string }>("SELECT id FROM tabs WHERE archivedAt IS NOT NULL ORDER BY archivedAt DESC LIMIT -1 OFFSET ?", [keep]);
  return [...new Set([...old, ...beyond].map((r) => r.id))];
}

export const readTabState = (db: SqlDatabase, id: string) => db.first<{ data: string }>("SELECT data FROM tab_state WHERE id = ?", [id])?.data ?? null;

export const writeTabState = (db: SqlDatabase, id: string, data: string | null) =>
  data === null ? db.run("DELETE FROM tab_state WHERE id = ?", [id]) : db.run("INSERT OR REPLACE INTO tab_state (id, data) VALUES (?, ?)", [id, data]);

export const maxVisitId = (db: SqlDatabase) => db.first<{ n: number | null }>("SELECT max(id) AS n FROM visits")?.n ?? 0;

export const insertVisit = (db: SqlDatabase, visit: Visit) =>
  db.run(`INSERT OR REPLACE INTO visits (${VISIT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`, [
    visit.id,
    visit.url,
    visit.title,
    visit.visitedAt,
    visit.profileSyncId,
    visit.transition,
  ]);

export const updateVisit = (db: SqlDatabase, visit: Visit) =>
  db.run("UPDATE visits SET url = ?, title = ? WHERE id = ?", [visit.url, visit.title, visit.id]);

export const newestVisits = (db: SqlDatabase, limit: number) =>
  db.all<Visit>(`SELECT ${VISIT_COLUMNS} FROM visits ORDER BY visitedAt DESC, id DESC LIMIT ?`, [limit]);

export const searchVisits = (db: SqlDatabase, text: string, limit: number) => {
  const pattern = escapeLike(text);
  return db.all<Visit>(
    `SELECT ${VISIT_COLUMNS} FROM visits WHERE title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' ORDER BY visitedAt DESC, id DESC LIMIT ?`,
    [pattern, pattern, limit],
  );
};

export const deleteVisitsBefore = (db: SqlDatabase, cutoff: number) => db.run("DELETE FROM visits WHERE visitedAt < ?", [cutoff]);

export const deleteVisitsSince = (db: SqlDatabase, since: number | null) =>
  since === null ? db.run("DELETE FROM visits") : db.run("DELETE FROM visits WHERE visitedAt >= ?", [since]);

export const countVisits = (db: SqlDatabase) => db.first<{ n: number }>("SELECT count(*) AS n FROM visits")?.n ?? 0;

export function readPreferences(db: SqlDatabase): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of db.all<{ key: string; value: string }>("SELECT key, value FROM preferences")) out[row.key] = row.value;
  return out;
}

export function writePreference(db: SqlDatabase, key: string, value: string | null) {
  if (value === null) db.run("DELETE FROM preferences WHERE key = ?", [key]);
  else db.run("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", [key, value]);
}
