import assert from "node:assert/strict";
import test from "node:test";
import { nodeDatabase } from "../../../test/nodeDatabase.ts";
import { createHistoryLog } from "../history/historyLog.ts";
import { parsePreferences } from "../settings/preferences.ts";
import type { BrowserTab } from "../tabs/tabModels.ts";
import {
  countArchivedTabs,
  deleteArchivedTabs,
  expiredArchivedIds,
  knownReceivedKeys,
  readArchivedTabs,
  readOpenTabs,
  readPreferences,
  readTabState,
  writeTabState,
  searchArchivedTabs,
  writePreference,
  writeTabs,
} from "./browserDatabase.ts";
import { migrate, SCHEMA_VERSION } from "./schema.ts";

const tab = (id: string, extra: Partial<BrowserTab> = {}): BrowserTab => ({
  id,
  url: `https://${id.toLowerCase()}.example/`,
  title: `Page ${id}`,
  created: 1,
  lastActive: 1,
  archivedAt: null,
  position: 0,
  profileSyncId: null,
  faviconUrl: null,
  themeColorHex: null,
  snapshotFileName: null,
  origin: "typed",
  receivedKey: null,
  receivedFromDevice: null,
  isPrivate: false,
  ...extra,
});

function fresh() {
  const db = nodeDatabase();
  assert.deepEqual(migrate(db), { from: 0, to: SCHEMA_VERSION });
  return db;
}

test("the schema has Android's tables, and migrating twice is a no-op", () => {
  const db = fresh();
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
  assert.deepEqual(tables, ["preferences", "tab_state", "tabs", "visits"]);
  assert.deepEqual(migrate(db), { from: SCHEMA_VERSION, to: SCHEMA_VERSION });
});

test("a database from a newer app is refused, not rewritten", () => {
  const db = nodeDatabase();
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  assert.deepEqual(migrate(db), { refused: SCHEMA_VERSION + 1 });
  assert.equal(db.all("SELECT name FROM sqlite_master WHERE type = 'table'").length, 0);
});

test("tabs round-trip, private ones are never written, archived ones read newest first", () => {
  const db = fresh();
  writeTabs(db, [tab("B", { position: 2048 }), tab("A", { position: 0, origin: "search" }), tab("P", { isPrivate: true })], []);
  writeTabs(db, [tab("X", { archivedAt: 10 }), tab("Y", { archivedAt: 20, title: "Otters" })], []);
  assert.deepEqual(readOpenTabs(db).map((t) => [t.id, t.origin]), [["A", "search"], ["B", "typed"]]);
  assert.deepEqual(readArchivedTabs(db, 10).map((t) => t.id), ["Y", "X"]);
  assert.equal(countArchivedTabs(db), 2);
  assert.deepEqual(searchArchivedTabs(db, "otter", 10).map((t) => t.id), ["Y"]);
  assert.deepEqual(searchArchivedTabs(db, "%", 10), []);
  writeTabs(db, [], ["A"]);
  assert.deepEqual(readOpenTabs(db).map((t) => t.id), ["B"]);
});

test("a tab's saved page state round-trips and goes with the tab", () => {
  const db = fresh();
  writeTabs(db, [tab("A")], []);
  writeTabState(db, "A", "c2F2ZWQ=");
  assert.equal(readTabState(db, "A"), "c2F2ZWQ=");
  writeTabs(db, [], ["A"]);
  assert.equal(readTabState(db, "A"), null);
});

test("expired archived tabs are found by age and by count", () => {
  const db = fresh();
  writeTabs(db, [tab("Old", { archivedAt: 1 }), tab("New", { archivedAt: 100 }), tab("Newer", { archivedAt: 200 })], []);
  assert.deepEqual(expiredArchivedIds(db, 50, 10), ["Old"]);
  assert.deepEqual(new Set(expiredArchivedIds(db, 0, 1)), new Set(["New", "Old"]));
  assert.deepEqual(new Set(deleteArchivedTabs(db)), new Set(["Old", "New", "Newer"]));
  assert.equal(countArchivedTabs(db), 0);
});

test("history records web visits, amends titles and summarizes per URL", () => {
  const db = fresh();
  const log = createHistoryLog(db);
  assert.equal(log.record("about:blank", "", "typed", null, 1), null);
  const first = log.record("https://otters.example/", "", "typed", null, 10)!;
  log.record("https://otters.example/", "Otters", "link", null, 20);
  log.record("https://seals.example/", "Seals", "link", null, 30);
  const amended = log.amend(first, { title: "Sea Otters" });
  assert.equal(amended.title, "Sea Otters");
  const rows = log.summary();
  assert.deepEqual(rows.map((r) => [r.url, r.visits, r.lastVisit]), [
    ["https://seals.example/", 1, 30],
    ["https://otters.example/", 2, 20],
  ]);
  assert.equal(rows[1]!.title, "Otters");
  assert.equal(createHistoryLog(db).record("https://next.example/", "", "typed", null, 40)!.id, 4);
  log.pruneBefore(25);
  assert.deepEqual(log.summary().map((r) => r.url), ["https://next.example/", "https://seals.example/"]);
});

test("preferences keep Android's keys and fall back on bad values", () => {
  const db = fresh();
  writePreference(db, "tabs.autoArchiveInterval", "week");
  writePreference(db, "browsing.searchSuggestions", "false");
  writePreference(db, "settings.color", "teal");
  const prefs = parsePreferences(readPreferences(db));
  assert.equal(prefs.autoArchiveInterval, "week");
  assert.equal(prefs.searchSuggestions, false);
  assert.equal(prefs.colorChoice, null);
  assert.equal(prefs.searchEngineId, "google");
  writePreference(db, "tabs.autoArchiveInterval", null);
  assert.equal(parsePreferences(readPreferences(db)).autoArchiveInterval, "day");
});

test("received keys already in the store are known, and the Mac's history removals cut only their profile's visits", () => {
  const db = nodeDatabase();
  migrate(db);
  writeTabs(db, [tab("A", { receivedKey: "k1" }), tab("B", { receivedKey: "k2", archivedAt: 5 }), tab("C")], []);
  assert.deepEqual([...knownReceivedKeys(db, ["k1", "k2", "k3"])].sort(), ["k1", "k2"]);
  assert.deepEqual([...knownReceivedKeys(db, [])], []);
  const log = createHistoryLog(db);
  log.record("https://a.example/", "A", "link", "work", 10);
  log.record("https://a.example/", "A", "link", null, 11);
  log.record("https://b.example/", "B", "link", "work", 12);
  log.removeVisits(["https://a.example/"], "work");
  assert.deepEqual(
    log.search("", 10).map((v) => `${v.url}|${v.profileSyncId}`),
    ["https://b.example/|work", "https://a.example/|null"],
  );
  log.removeVisits(["https://a.example/"], null);
  assert.deepEqual(
    log.search("", 10).map((v) => v.url),
    ["https://b.example/"],
  );
});
