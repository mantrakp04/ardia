import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { DAY_MS, historyCutoff, historyOf, shortensHistory, withoutVisitsBefore } = await import("./history.ts");
const { migrateHistoryFile } = await import("./engineSync.ts");
const { RETENTION_DOCUMENT, expireOldHistory, historyTrimmedBefore, keepHistoryFor } = await import("./retention.ts");
const { DEFAULT_SETTINGS, SETTING_SPECS, parseSettings } = await import("../settings/settings.ts");
const { SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { isConfigSettingKey } = await import("../settings/configAllowlist.ts");
const { syncedHistorySince } = await import("../sync/adapters.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const NOW = Date.now();
const chrome = (engine) => [...stub.chromeHistory(engine)].map(([url, row]) => `${url} ${row.visits.map((t) => Math.round((NOW - t) / DAY_MS)).join(",")}`).sort();
const shown = (profileId) => historyOf(S(), profileId).map((h) => `${h.url} ${h.visits} ${h.visitTimes.map((t) => Math.round((NOW - t) / DAY_MS)).join(",")}`);

function seed(engine, pages) {
  for (const [url, ages] of pages) for (const age of ages) stub.chromeHistory(engine).set(url, { title: url, visits: [...(stub.chromeHistory(engine).get(url)?.visits ?? []), NOW - age * DAY_MS].sort((a, b) => a - b) });
  const list = [...stub.chromeHistory(engine)]
    .map(([url, row]) => ({ url, title: url, favicon: null, visits: row.visits.length, lastVisit: row.visits.at(-1), visitTimes: row.visits }))
    .sort((a, b) => b.lastVisit - a.lastVisit);
  useBrowser.setState((s) => ({ history: { ...s.history, [engine]: { list, floor: -Infinity, ready: true } } }));
}

test("keep history: Forever by default, local to this Mac, and not settable from config.json", () => {
  assert.equal(DEFAULT_SETTINGS.keepHistory, "forever");
  assert.equal(SETTING_SPECS.keepHistory.synced, false);
  assert.ok(!SYNCED_SETTINGS.includes("keepHistory"), "a change on one Mac never deletes history on another");
  assert.ok(!isConfigSettingKey("keepHistory"));
  assert.deepEqual(SETTING_SPECS.keepHistory.values, ["forever", "year", "threeMonths", "month"]);
  assert.equal(parseSettings({ keepHistory: "month" }).keepHistory, "month");
  assert.equal(parseSettings({ keepHistory: "week" }).keepHistory, "forever", "an unknown period reads as Forever");
  assert.equal(parseSettings({ keepHistory: 30 }).keepHistory, "forever");
});

test("keep history: the cutoff for each period, and which changes delete anything", () => {
  assert.equal(historyCutoff("forever", NOW), null);
  assert.equal(historyCutoff("year", NOW), NOW - 365 * DAY_MS);
  assert.equal(historyCutoff("threeMonths", NOW), NOW - 90 * DAY_MS);
  assert.equal(historyCutoff("month", NOW), NOW - 30 * DAY_MS);
  assert.ok(shortensHistory("forever", "year"));
  assert.ok(shortensHistory("year", "month"));
  assert.ok(!shortensHistory("month", "year"), "keeping more deletes nothing");
  assert.ok(!shortensHistory("month", "forever"));
  assert.ok(!shortensHistory("year", "year"));
});

test("keep history: Forever deletes nothing, in Chrome or in the list", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  seed("", [["https://old.example/", [800]]]);
  assert.deepEqual(await expireOldHistory(NOW), []);
  assert.deepEqual(chrome(""), ["https://old.example/ 800"]);
  assert.deepEqual(shown("default"), ["https://old.example/ 1 800"]);
});

test("keep history: a shorter period deletes older visits in every profile's history once, and never touches incognito", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  const work = S().createProfile({ name: "Work" });
  const shared = S().createProfile({ name: "Shared", shareWith: "default" });
  const workEngine = S().profiles[work].dataId ?? work;
  useBrowser.setState((s) => ({ profiles: { ...s.profiles, "incognito:1@default": { id: "incognito:1@default", name: "Incognito", color: "neutral", icon: null, createdAt: 0 } } }));
  seed("", [
    ["https://old.example/", [400, 200]],
    ["https://mixed.example/", [100, 40, 2]],
    ["https://new.example/", [1]],
  ]);
  seed(workEngine, [
    ["https://work-old.example/", [45]],
    ["https://work-new.example/", [3]],
  ]);
  seed("incognito:1@", [["https://private.example/", [45]]]);

  await keepHistoryFor("month");
  assert.equal(S().settings.keepHistory, "month");
  assert.deepEqual(chrome(""), ["https://mixed.example/ 2", "https://new.example/ 1"]);
  assert.deepEqual(chrome(workEngine), ["https://work-new.example/ 3"]);
  assert.deepEqual(chrome("incognito:1@"), ["https://private.example/ 45"], "incognito history isn't Chrome's to keep");
  assert.deepEqual(shown("default"), ["https://new.example/ 1 1", "https://mixed.example/ 1 2"], "the list drops the deleted visits at once");
  assert.deepEqual(shown(shared), shown("default"), "a profile sharing the original's data sees the same list");
  assert.deepEqual(shown(work), ["https://work-new.example/ 1 3"]);

  const before = S().history;
  assert.deepEqual((await expireOldHistory(NOW)).sort(), ["", workEngine].sort(), "each engine profile once, shared ones included");
  assert.equal(S().history, before, "a second pass with nothing older leaves the list alone");
});

test("keep history: sync's own window shrinks to this Mac's period and stays 90 days otherwise", () => {
  S().hydrate({});
  const now = Date.now();
  assert.equal(syncedHistorySince(now), now - 90 * DAY_MS);
  S().updateSettings({ keepHistory: "year" });
  assert.equal(syncedHistorySince(now), now - 90 * DAY_MS);
  S().updateSettings({ keepHistory: "month" });
  assert.equal(syncedHistorySince(now), now - 30 * DAY_MS);
});

test("keep history: the cutoff it trimmed to is saved, and never moves back", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  stub.docs.delete(RETENTION_DOCUMENT);
  assert.equal(historyTrimmedBefore(), -Infinity);
  await expireOldHistory(NOW);
  assert.equal(historyTrimmedBefore(), -Infinity, "Forever trims nothing");
  S().updateSettings({ keepHistory: "month" });
  await expireOldHistory(NOW);
  assert.equal(historyTrimmedBefore(), NOW - 30 * DAY_MS);
  S().updateSettings({ keepHistory: "year" });
  await expireOldHistory(NOW + DAY_MS);
  assert.equal(historyTrimmedBefore(), NOW - 30 * DAY_MS, "a longer period doesn't move it back");
  stub.docs.set(RETENTION_DOCUMENT, JSON.stringify({ version: 2, trimmedBefore: NOW }));
  assert.equal(historyTrimmedBefore(), -Infinity, "a newer version reads as nothing");
  stub.docs.set(RETENTION_DOCUMENT, JSON.stringify({ version: 1, trimmedBefore: "soon" }));
  assert.equal(historyTrimmedBefore(), -Infinity);
});

test("keep history: a failed deletion doesn't count as trimmed, and the next pass tries again", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  stub.docs.delete(RETENTION_DOCUMENT);
  const work = S().createProfile({ name: "Work" });
  const workEngine = S().profiles[work].dataId ?? work;
  seed("", [["https://old.example/", [45]]]);
  seed(workEngine, [["https://work-old.example/", [45]]]);
  S().updateSettings({ keepHistory: "month" });

  stub.historyExpiryFails.add(workEngine);
  try {
    assert.deepEqual(await expireOldHistory(NOW), [""], "only the profile Chrome deleted from");
  } finally {
    stub.historyExpiryFails.delete(workEngine);
  }
  assert.deepEqual(chrome(""), []);
  assert.deepEqual(shown("default"), []);
  assert.deepEqual(chrome(workEngine), ["https://work-old.example/ 45"]);
  assert.deepEqual(shown(work), ["https://work-old.example/ 1 45"], "the list keeps what Chrome still has");
  assert.equal(historyTrimmedBefore(), -Infinity, "sync doesn't treat it as deleted yet");

  assert.deepEqual((await expireOldHistory(NOW)).sort(), ["", workEngine].sort());
  assert.deepEqual(chrome(workEngine), []);
  assert.deepEqual(shown(work), []);
  assert.equal(historyTrimmedBefore(), NOW - 30 * DAY_MS);
});

test("keep history: trimming a page with more visits than the list tracks counts only the visits left", () => {
  const times = Array.from({ length: 50 }, (_, i) => NOW - (49 - i) * DAY_MS);
  const entry = { url: "https://busy.example/", title: "Busy", favicon: null, visits: 200, lastVisit: times.at(-1), visitTimes: times };
  const kept = withoutVisitsBefore(entry, NOW - 29.5 * DAY_MS);
  assert.equal(kept.visitTimes.length, 30);
  assert.equal(kept.visits, 30, "the 150 untracked visits are older still, so they went too");
  assert.equal(withoutVisitsBefore(entry, NOW - 60 * DAY_MS), entry, "nothing tracked is older: unchanged");
});

test("keep history: an import leaves out what's older than the period", async () => {
  S().hydrate({});
  stub.historyDbs.clear();
  S().updateSettings({ keepHistory: "month" });
  const added = S().importHistory("default", [
    { url: "https://arc-old.example/", title: "Old", visits: 3, lastVisit: NOW - 400 * DAY_MS },
    { url: "https://arc-new.example/", title: "New", visits: 2, lastVisit: NOW - 2 * DAY_MS },
  ]);
  assert.equal(added, 1);
  assert.deepEqual(historyOf(S(), "default").map((h) => h.url), ["https://arc-new.example/"]);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(chrome(""), ["https://arc-new.example/ 2"], "Chrome gets only the rows inside the period");
});

test("keep history: Forever moves history.json's older visits into Chrome, a period leaves them out", async () => {
  const entry = (url, age) => ({ url, title: url, favicon: null, visits: 1, lastVisit: NOW - age * DAY_MS, visitTimes: [NOW - age * DAY_MS] });
  const file = JSON.stringify({ version: 2, history: { default: [entry("https://ancient.example/", 400), entry("https://fresh.example/", 2)] } });

  S().hydrate({});
  stub.historyDbs.clear();
  stub.docs.set("history.json", file);
  assert.equal(await migrateHistoryFile(NOW, { keepMs: 0 }), "moved");
  assert.deepEqual(chrome(""), ["https://ancient.example/ 400", "https://fresh.example/ 2"]);

  S().hydrate({});
  stub.historyDbs.clear();
  S().updateSettings({ keepHistory: "month" });
  stub.docs.set("history.json", file);
  assert.equal(await migrateHistoryFile(NOW, { keepMs: 0 }), "moved");
  assert.deepEqual(chrome(""), ["https://fresh.example/ 2"]);
});
