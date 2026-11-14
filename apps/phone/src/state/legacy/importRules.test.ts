import assert from "node:assert/strict";
import test from "node:test";
import { legacyData, T } from "../../../test/legacyFixture.ts";
import { nodeDatabase } from "../../../test/nodeDatabase.ts";
import { parsePreferences } from "../settings/preferences.ts";
import { hasBrowserData, ImportMismatch, readArchivedTabs, readOpenTabs, readPreferences, readTabState, writeImport } from "../store/browserDatabase.ts";
import { migrate } from "../store/schema.ts";
import { launchTabs } from "../tabs/tabsState.ts";
import { importPlan, importStep, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION } from "./importRules.ts";

test("open tabs keep their order, state, profile, received keys and look; bad addresses stay behind", () => {
  const plan = importPlan(legacyData());
  const open = plan.tabs.filter((t) => t.archivedAt === null);
  assert.deepEqual(
    open.map((t) => t.url),
    ["https://en.wikipedia.org/wiki/Otter", "https://example.com/"],
  );
  const otter = open[0]!;
  assert.equal(otter.id, "6f9619ff-8b86-d011-b42d-00c04fc964ff");
  assert.equal(otter.position, 1024);
  assert.equal(otter.profileSyncId, "work");
  assert.equal(otter.origin, "search");
  assert.equal(otter.faviconUrl, "https://en.wikipedia.org/favicon.ico");
  assert.equal(otter.themeColorHex, "#FFFFFF");
  assert.equal(otter.snapshotFileName, "file:///var/mobile/Containers/Data/Application/X/Library/Caches/TabSnapshots/otter.jpg");
  assert.equal(otter.created, T);
  assert.equal(otter.lastActive, T + 5_000);
  assert.equal(open[1]!.receivedKey, "k-1");
  assert.equal(open[1]!.receivedFromDevice, "Mac Studio");
  assert.equal(open[1]!.origin, "sent");
  assert.deepEqual(plan.states, [{ id: otter.id, data: "AAECAw==" }]);
});

test("the archive comes with its archive time, and an unknown origin reads as typed", () => {
  const archived = importPlan(legacyData()).tabs.filter((t) => t.archivedAt !== null);
  assert.equal(archived.length, 1);
  assert.equal(archived[0]!.archivedAt, T - 7_000);
  assert.equal(archived[0]!.origin, "typed");
  assert.equal(archived[0]!.snapshotFileName, null);
});

test("visits come oldest first with their transitions, web addresses only", () => {
  const visits = importPlan(legacyData()).visits;
  assert.deepEqual(
    visits.map((v) => `${v.transition}|${v.url}|${v.profileSyncId}`),
    ["formSubmit|https://www.google.com/search?q=otters|null", "typed|https://en.wikipedia.org/wiki/Otter|work", "link|https://example.com/|null", "other|https://odd.example/|null"],
  );
});

test("preferences map key by key to the app's own, and the rest are listed as having no home", () => {
  const { preferences, unmapped } = importPlan(legacyData());
  const parsed = parsePreferences(preferences);
  assert.equal(parsed.autoArchiveInterval, "week");
  assert.equal(parsed.nightShade, "automatic");
  assert.equal(parsed.searchEngineId, "duckduckgo");
  assert.equal(parsed.searchSuggestions, false);
  assert.equal(parsed.hasFinishedOnboarding, true);
  assert.equal(parsed.colorChoice, "green");
  assert.equal(parsed.readerStep, 4);
  assert.equal(parsed.readerSerif, false);
  assert.equal(parsed.readerTheme, null);
  assert.equal("reader.theme" in preferences, false);
  assert.deepEqual(unmapped, [
    "blocking.ads",
    "blocking.exemptHosts",
    "browsing.sites",
    "browsing.swipeNavigation",
    "defaultBrowser.askedAt",
    "filters.selection",
    "settings.bottom",
  ]);
});

test("the import runs once, only with legacy data and only over an empty store", () => {
  assert.equal(importStep({ available: true, marker: null, hasData: false }), "import");
  assert.equal(importStep({ available: true, marker: null, hasData: true }), "markExisting");
  assert.equal(importStep({ available: true, marker: "1", hasData: true }), "done");
  assert.equal(importStep({ available: false, marker: null, hasData: false }), "none");
});

test("the import writes everything in one transaction, checks the counts, then marks itself done", () => {
  const db = nodeDatabase();
  migrate(db);
  assert.equal(hasBrowserData(db), false);
  const plan = importPlan(legacyData());
  writeImport(db, plan, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION);
  assert.equal(readOpenTabs(db).length, 2);
  assert.equal(readArchivedTabs(db, 10).length, 1);
  assert.equal(readTabState(db, "6f9619ff-8b86-d011-b42d-00c04fc964ff"), "AAECAw==");
  const stored = readPreferences(db);
  assert.equal(stored[LEGACY_IMPORT_KEY], LEGACY_IMPORT_VERSION);
  assert.equal(parsePreferences(stored).hasFinishedOnboarding, true);
  assert.equal(launchTabs(readOpenTabs(db), 1).selectedId, "1b4e28ba-2fa1-11d2-883f-0016d3cca427");
  assert.equal(hasBrowserData(db), true);
  assert.throws(() => writeImport(db, plan, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION));
  assert.equal(readOpenTabs(db).length, 2);
});

test("a count that does not add up rolls the whole import back and leaves no marker", () => {
  const db = nodeDatabase();
  migrate(db);
  const plan = importPlan(legacyData());
  const twice = { ...plan, states: [...plan.states, ...plan.states] };
  assert.throws(() => writeImport(db, twice, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION), ImportMismatch);
  assert.equal(hasBrowserData(db), false);
  assert.equal(readPreferences(db)[LEGACY_IMPORT_KEY], undefined);
});
