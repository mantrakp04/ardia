import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { editDistance, groupByPane, search } from "./searchMatch.ts";
import { SETTINGS, SETTINGS_INDEX } from "./settingsIndex.ts";

const ids = (query) => search(SETTINGS_INDEX, query).map((h) => h.entry.id);
const first = (query) => ids(query)[0];

test("synonyms find the setting they stand for", () => {
  assert.equal(first("cookies"), "privacy.blockCookieBanners");
  assert.equal(first("dark"), "appearance.theme");
  assert.equal(first("dark mode"), "appearance.theme");
  assert.equal(first("adblock"), "privacy.blockAds");
  assert.equal(first("tracking"), "privacy.blockTrackers");
  assert.equal(first("pip"), "tabs.autoPictureInPicture");
  assert.equal(first("vertical tabs"), "tabs.layout");
  assert.equal(first("1password"), "passwords.managerApps");
});

test("a pane's name finds that pane's rows first", () => {
  const found = search(SETTINGS_INDEX, "password");
  const passwordsRows = SETTINGS.filter((s) => s.pane === "passwords").map((s) => s.id);
  assert.ok(passwordsRows.every((id) => found.some((h) => h.entry.id === id)), "every Passwords row is found");
  assert.equal(groupByPane(found)[0].pane, "passwords");
});

test("titles rank above descriptions", () => {
  assert.equal(first("history"), "advanced.history");
  assert.equal(first("recently closed"), "general.windowsAndTabs");
  assert.ok(search(SETTINGS_INDEX, "dark").every((h) => h.entry.id === "appearance.theme" || h.score < search(SETTINGS_INDEX, "dark")[0].score));
});

test("typos still find the setting", () => {
  assert.equal(first("trakers"), "privacy.blockTrackers");
  assert.equal(search(SETTINGS_INDEX, "pasword")[0].entry.pane, "passwords");
  assert.equal(first("appearence"), "appearance.theme");
  assert.equal(first("upscalling"), "tabs.videoUpscaling");
  assert.equal(first("extensoins"), "extensions.installed");
});

test("every word of the query has to match", () => {
  assert.deepEqual(ids("block ads"), ["privacy.blockAds"].concat(ids("block ads").slice(1)));
  assert.ok(!ids("block ads").includes("privacy.blockTrackers"));
  assert.equal(first("warn quitting"), "general.warnBeforeQuitting");
});

test("garbage finds nothing", () => {
  for (const q of ["zzzz", "qwxv", "xylophone", "asdfgh", "kubernetes"]) assert.deepEqual(ids(q), [], q);
});

test("short queries match word starts only", () => {
  assert.ok(ids("ta").every((id) => SETTINGS.find((s) => s.id === id)), "results exist");
  assert.ok(!ids("ar").includes("privacy.blockTrackers"));
});

test("results group by pane, best group first, best row first", () => {
  const groups = groupByPane(search(SETTINGS_INDEX, "tabs"));
  assert.equal(groups[0].pane, "tabs");
  for (const g of groups) for (let i = 1; i < g.hits.length; i++) assert.ok(g.hits[i - 1].score >= g.hits[i].score);
  const panes = groups.map((g) => g.pane);
  assert.equal(new Set(panes).size, panes.length);
});

test("an empty query finds nothing", () => {
  assert.deepEqual(ids(""), []);
  assert.deepEqual(ids("   "), []);
});

test("edit distance counts a swap as one edit", () => {
  assert.equal(editDistance("tabs", "tbas", 2), 1);
  assert.equal(editDistance("kitten", "sitting", 3), 3);
  assert.equal(editDistance("abc", "abcdefg", 2), 3);
});

test("every indexed setting is anchored in its pane, and every anchor is indexed", () => {
  const dir = new URL("./panes/", import.meta.url);
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
  const panes = new Set(SETTINGS.map((s) => s.pane));
  const anchors = new Set([...sources.matchAll(/["`]([a-zA-Z]+)\.([a-zA-Z]+)["`]/g)].filter((m) => panes.has(m[1])).map((m) => `${m[1]}.${m[2]}`));
  const indexed = new Set(SETTINGS.map((s) => s.id));
  for (const id of indexed) assert.ok(anchors.has(id), `${id} is in the index but no pane anchors it`);
  for (const id of anchors) assert.ok(indexed.has(id), `${id} is anchored in a pane but not in the index`);
});

test("every settings row with a fixed title is searchable", () => {
  const dir = new URL("./panes/", import.meta.url);
  const notSettings = /Sheet$|Connect$|Details|List$/;
  const statusRows = new Set(["iCloud Drive is off on this Mac"]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const m of source.matchAll(/<Row\b([^>]*?)title="([^"]+)"/gs)) {
      const owner = [...source.slice(0, m.index).matchAll(/^(?:export )?function (\w+)/gm)].at(-1)?.[1] ?? "";
      if (notSettings.test(owner) || /^(No |Just |\s*$)/.test(m[2]) || statusRows.has(m[2])) continue;
      assert.ok(/anchor=/.test(m[1]), `${file}: <Row title="${m[2]}"> in ${owner} has no anchor, so search can't find it`);
    }
  }
});
