import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { editDistance, search, snippetAround, splitByRanges } from "./searchMatch.ts";
import { ADVANCED_PANES, SETTINGS, SETTINGS_INDEX } from "./settingsIndex.ts";

const ids = (query) => search(SETTINGS_INDEX, query).map((h) => h.entry.id);
const first = (query) => ids(query)[0];

const TOP = [
  ["cli", ["advanced.cliInstall"]],
  ["shell", ["advanced.cliInstall"]],
  ["devtools", ["advanced.cliControl"]],
  ["remote debugging", ["advanced.cliControl"]],
  ["command line", ["advanced.cliInstall", "advanced.cliControl"]],
  ["terminal", ["advanced.cliInstall", "advanced.cliControl"]],
  ["ardia command", ["advanced.cliInstall"]],
  ["dark", ["appearance.theme"]],
  ["dark mode", ["appearance.theme"]],
  ["theme", ["appearance.theme"]],
  ["glass", ["appearance.glassTintWithTheme", "appearance.interfaceStyle"]],
  ["liquid glass", ["appearance.interfaceStyle", "appearance.glassTintAmount"]],
  ["tint", ["appearance.glassTintAmount", "appearance.glassTintWithTheme"]],
  ["default browser", ["general.defaultBrowser"]],
  ["search engine", ["search.defaultEngine"]],
  ["ad block", ["privacy.blockAds"]],
  ["adblock", ["privacy.blockAds"]],
  ["block ads", ["privacy.blockAds"]],
  ["trackers", ["privacy.blockTrackers"]],
  ["cookies", ["privacy.blockCookieBanners"]],
  ["import", ["general.importBrowser", "passwords.importPasswords", "advanced.bookmarksImport"]],
  ["import from chrome", ["general.importBrowser"]],
  ["profile", ["profiles.defaultProfile", "profiles.list"]],
  ["sidebar", ["tabs.sidebarSide"]],
  ["right sidebar", ["tabs.sidebarSide"]],
  ["vertical tabs", ["tabs.layout"]],
  ["pinned", ["profiles.shareTopApps", "tabs.balancedTopApps", "tabs.fadeUnloadedTabs"]],
  ["split", ["tabs.splitLinkModifier"]],
  ["split view", ["tabs.splitLinkModifier"]],
  ["peek", ["tabs.peekModifier", "tabs.peekLinksToOtherSites"]],
  ["pip", ["tabs.autoPictureInPicture"]],
  ["picture in picture", ["tabs.autoPictureInPicture"]],
  ["mini player", ["tabs.autoPictureInPicture"]],
  ["downloads", ["advanced.downloads", "general.downloadsFolder"]],
  ["download folder", ["general.downloadsFolder"]],
  ["shortcuts", ["shortcuts.actions", "shortcuts.extensionShortcuts"]],
  ["keyboard shortcuts", ["shortcuts.actions"]],
  ["hotkeys", ["shortcuts.actions", "shortcuts.extensionShortcuts"]],
  ["⌘L", ["appearance.commandBarPlacement"]],
  ["⌘z", ["shortcuts.undoReopensClosedTab"]],
  ["update", ["general.updateChannel", "general.autoUpdate"]],
  ["nightly", ["general.updateChannel"]],
  ["channel", ["general.updateChannel"]],
  ["sync", ["sync.sync"]],
  ["extensions", ["extensions.installed"]],
  ["zoom", ["privacy.commandScrollZoom"]],
  ["font", ["privacy.commandScrollZoom"]],
  ["telemetry", ["privacy.whatsSent", "privacy.shareDiagnostics", "privacy.viewData"]],
  ["what's sent", ["privacy.whatsSent"]],
  ["whats sent", ["privacy.whatsSent"]],
  ["crash reports", ["privacy.shareDiagnostics"]],
  ["upscal", ["tabs.videoUpscaling"]],
  ["upscaling", ["tabs.videoUpscaling"]],
  ["unread", ["tabs.showUnreadCounts"]],
  ["notification", ["tabs.showUnreadCounts"]],
  ["notifications", ["tabs.showUnreadCounts"]],
  ["notis", ["tabs.showUnreadCounts"]],
  ["badge", ["tabs.showUnreadCounts"]],
  ["bubble", ["tabs.showUnreadCounts"]],
  ["notification bubbles", ["tabs.showUnreadCounts"]],
  ["count", ["tabs.showUnreadCounts"]],
  ["dot", ["tabs.showUnreadCounts"]],
  ["location", ["privacy.sitePermissions"]],
  ["camera", ["privacy.sitePermissions"]],
  ["microphone", ["privacy.sitePermissions"]],
  ["startup", ["general.openAtLogin"]],
  ["little arc", ["general.openLinksInLittleArdia"]],
  ["little ardia", ["general.openLinksInLittleArdia"]],
  ["little window", ["general.openLinksInLittleArdia"]],
  ["links from other apps", ["general.openLinksInLittleArdia"]],
  ["slack", ["general.openLinksInLittleArdia"]],
  ["onboarding", ["general.redoSetup"]],
  ["redo", ["general.redoSetup"]],
  ["welcome", ["general.redoSetup"]],
  ["setup", ["general.redoSetup", "general.setupCode"]],
  ["restore", ["general.windowsAndTabs"]],
  ["recently closed", ["general.windowsAndTabs"]],
  ["autohide", ["tabs.autoHideTabs"]],
  ["auto hide", ["tabs.autoHideTabs"]],
  ["history", ["advanced.history"]],
  ["borderless mode", ["appearance.borderlessMode"]],
  ["mouse wheel", ["privacy.commandScrollZoom"]],
  ["1password", ["passwords.managerApps"]],
  ["warn quitting", ["general.warnBeforeQuitting"]],
  ["trakers", ["privacy.blockTrackers"]],
  ["appearence", ["appearance.theme"]],
  ["upscalling", ["tabs.videoUpscaling"]],
  ["extensoins", ["extensions.installed"]],
];

test("real queries put the setting people mean first", () => {
  const misses = TOP.filter(([q, want]) => !want.includes(first(q))).map(([q, want]) => `${q}: got ${first(q)}, want ${want.join(" or ")}`);
  assert.deepEqual(misses, []);
  assert.ok(TOP.length >= 40);
});

test("whole-word hits rank above word prefixes, and a loose keyword no longer wins", () => {
  const found = ids("cli");
  assert.equal(found[0], "advanced.cliInstall");
  assert.ok(!found.includes("privacy.whatsSent"));
  const clickRows = found.filter((id) => /[Cc]lick/.test(SETTINGS.find((s) => s.id === id).title));
  assert.ok(clickRows.length && clickRows.every((id) => found.indexOf(id) > 0));
});

const placeOf = (id) => {
  const entry = SETTINGS.find((s) => s.id === id);
  return `${entry.pane} › ${entry.section}`;
};

const COLLAPSED = [
  ["cli", "advanced.cliInstall", ["advanced.cliControl"]],
  ["terminal", "advanced.cliInstall", ["advanced.cliControl"]],
  ["shell", "advanced.cliInstall", ["advanced.cliControl"]],
  ["dark", "appearance.theme", ["appearance.adaptTextToColor", "appearance.spacesFollowAppearance"]],
  ["telemetry", "privacy.whatsSent", ["privacy.shareDiagnostics"]],
  ["downloads", "general.downloadsFolder", ["general.askWhereToSave", "general.downloadsAllProfiles"]],
  ["import", "general.importBrowser", ["general.exportBookmarks", "general.setupCode"]],
];

test("results that land on the same place collapse into one", () => {
  for (const [query, kept, folded] of COLLAPSED) {
    const found = ids(query);
    assert.ok(found.includes(kept), `${query}: ${kept} is shown`);
    for (const id of folded) {
      assert.equal(placeOf(id), placeOf(kept), `${query}: ${id} lands where ${kept} does`);
      assert.ok(!found.includes(id), `${query}: ${id} folds into ${kept}`);
    }
  }
  for (const query of ["cli", "terminal", "dark", "telemetry", "downloads", "import", "tabs", "glass", "sidebar", "hotkeys", "notification"]) {
    const unnamed = search(SETTINGS_INDEX, query).filter((h) => !h.title.length && h.entry.paneTitle.toLowerCase() !== query);
    const places = unnamed.map((h) => placeOf(h.entry.id));
    assert.equal(new Set(places).size, places.length, `${query}: one result per place among rows matched without their title`);
  }
});

test("rows named by the query stay apart even when they share a place", () => {
  const tabs = search(SETTINGS_INDEX, "tabs").filter((h) => h.entry.section === "Tab layout");
  assert.ok(tabs.length >= 2, "several Tab layout rows say tabs in their names");
  assert.ok(tabs.every((h) => h.title.length));
  assert.deepEqual(ids("command line").slice(0, 2).sort(), ["advanced.cliControl", "advanced.cliInstall"]);
  assert.equal(first("devtools"), "advanced.cliControl");
});

test("a pane's name finds that pane's rows", () => {
  const found = search(SETTINGS_INDEX, "passwords");
  const passwordsRows = SETTINGS.filter((s) => s.pane === "passwords").map((s) => s.id);
  assert.ok(passwordsRows.every((id) => found.some((h) => h.entry.id === id)), "every Passwords row is found");
  assert.equal(found[0].entry.pane, "passwords");
  assert.equal(search(SETTINGS_INDEX, "privacy")[0].entry.pane, "privacy");
  assert.equal(search(SETTINGS_INDEX, "pasword")[0].entry.pane, "passwords");
});

test("titles rank above keywords, keywords above descriptions", () => {
  const dark = search(SETTINGS_INDEX, "dark");
  assert.equal(dark[0].entry.id, "appearance.theme");
  assert.ok(dark.slice(1).every((h) => h.tier < dark[0].tier || h.score < dark[0].score));
  const theme = search(SETTINGS_INDEX, "theme");
  assert.ok(theme.findIndex((h) => h.entry.id === "appearance.theme") < theme.findIndex((h) => h.note));
});

test("every word of the query has to match", () => {
  assert.ok(!ids("block ads").includes("privacy.blockTrackers"));
  assert.ok(ids("the ardia command").includes("advanced.cliInstall"));
});

test("garbage finds nothing", () => {
  for (const q of ["zzzz", "qwxv", "xylophone", "asdfgh", "kubernetes"]) assert.deepEqual(ids(q), [], q);
});

test("short queries match word starts only", () => {
  assert.ok(ids("ta").length);
  assert.ok(!ids("ar").includes("privacy.blockTrackers"));
});

test("results come in one relevance order, not pane order", () => {
  const hits = search(SETTINGS_INDEX, "tabs");
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].tier >= hits[i].tier, `${hits[i - 1].entry.id} before ${hits[i].entry.id}`);
  const cli = search(SETTINGS_INDEX, "cli").map((h) => h.entry.pane);
  assert.equal(cli[0], "advanced");
});

test("matches carry ranges to highlight, in the text shown", () => {
  const [hit] = search(SETTINGS_INDEX, "what's sent");
  assert.deepEqual(splitByRanges(hit.entry.title, hit.title), [{ text: "What's", highlighted: true }, { text: " ", highlighted: false }, { text: "Sent", highlighted: true }]);
  const cli = search(SETTINGS_INDEX, "cli").find((h) => h.entry.id === "tabs.cmdClickCreatesTabGroup");
  assert.deepEqual(splitByRanges(cli.entry.title, cli.title).filter((p) => p.highlighted).map((p) => p.text), ["cli"]);
  const term = search(SETTINGS_INDEX, "terminal")[0];
  assert.deepEqual(term.title, []);
  assert.equal(term.note.text, "terminal");
  const pip = search(SETTINGS_INDEX, "picture in picture")[0];
  assert.ok(pip.title.length >= 1);
  const line = search(SETTINGS_INDEX, "command line")[0];
  assert.ok(line.title.length >= 1);
});

test("a long matching text shows the part around its match", () => {
  const text = "Right-click empty space in the sidebar and choose New Live Folder to add one.";
  const at = text.indexOf("Live");
  const cut = snippetAround(text, [{ start: at, end: at + 4 }], 30);
  assert.ok(cut.text.startsWith("…"));
  assert.equal(cut.text.slice(cut.ranges[0].start, cut.ranges[0].end), "Live");
});

test("every pane keeps a basic setting unless it hides whole", () => {
  const panes = new Set(SETTINGS.map((s) => s.pane));
  for (const pane of panes) if (!ADVANCED_PANES.has(pane)) assert.ok(SETTINGS.some((s) => s.pane === pane && !s.advanced), pane);
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
  const anchors = new Set([
    ...[...sources.matchAll(/["`]([a-zA-Z]+)\.([a-zA-Z]+)["`]/g)].filter((m) => panes.has(m[1])).map((m) => `${m[1]}.${m[2]}`),
    ...[...sources.matchAll(/<SourceRow id="(\w+)"/g)].map((m) => `liveFolders.${m[1]}`),
  ]);
  const indexed = new Set(SETTINGS.map((s) => s.id));
  for (const id of indexed) assert.ok(anchors.has(id), `${id} is in the index but no pane anchors it`);
  for (const id of anchors) assert.ok(indexed.has(id), `${id} is anchored in a pane but not in the index`);
});

test("every settings row with a fixed title is searchable", () => {
  const dir = new URL("./panes/", import.meta.url);
  const notSettings = /Sheet$|Connect$|Details|List$/;
  const statusRows = new Set(["iCloud Drive is off on this Mac", "uBlock Origin isn't answering"]);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(new URL(file, dir), "utf8");
    for (const m of source.matchAll(/<Row\b([^>]*?)title="([^"]+)"/gs)) {
      const owner = [...source.slice(0, m.index).matchAll(/^(?:export )?function (\w+)/gm)].at(-1)?.[1] ?? "";
      if (notSettings.test(owner) || /^(No |Just |\s*$)/.test(m[2]) || statusRows.has(m[2])) continue;
      assert.ok(/anchor=/.test(m[1]), `${file}: <Row title="${m[2]}"> in ${owner} has no anchor, so search can't find it`);
    }
  }
});

test("a row its pane doesn't draw is left out of search, by the same rule the pane hides it with", async () => {
  const { unshownSettings } = await import("./settingsIndex.ts");
  const { DEFAULT_SETTINGS } = await import("../../state/settings/settings.ts");
  const unshown = (settings, env) => new Set(unshownSettings({ ...DEFAULT_SETTINGS, ...settings }, env).split("\n").filter(Boolean));
  const across = unshown({}, { top: true });
  assert.ok(!across.has("tabs.showSidebarButton"), "the Hide Tabs button shows in both layouts");
  for (const id of ["tabs.showClearButton", "tabs.balancedTopApps", "tabs.newTabButtonPosition"]) assert.ok(across.has(id), id);
  assert.deepEqual([...unshown({ glassTintWithTheme: true }, { top: false, glass: true })], ["tabs.dragToGroupInTopStrip"]);
  assert.ok(unshown({}, { top: false, glass: true }).has("appearance.glassTintAmount"));
  for (const id of ["appearance.interfaceStyle", "appearance.glassTintWithTheme", "appearance.glassTintAmount"]) assert.ok(unshown({}, { top: false }).has(id), id);
  const classic = unshown({ interfaceStyle: "classic" }, { top: false, glass: true });
  assert.deepEqual([...classic], ["tabs.dragToGroupInTopStrip", "appearance.glassTintWithTheme", "appearance.glassTintAmount"]);
  assert.ok(unshown({ memorySaver: false }, { top: false }).has("advanced.memorySaverMode"));
  assert.ok(unshown({ pageEngine: "webkit" }, { top: false }).has("engines.protectedVideo"));
  const borderless = unshown({ borderlessMode: true }, { top: false });
  assert.ok(borderless.has("appearance.pageFrame"));
  assert.ok(!borderless.has("appearance.borderlessMode"));
});

const SHOWN_BY_LOADED_DATA = ["General.tsx: general.downloadsAllProfiles", "General.tsx: general.updateChannel"];

test("panes leave showing and hiding an anchored row to the row's own rule", () => {
  const dir = new URL("./panes/", import.meta.url);
  const wrapped = readdirSync(dir).flatMap((file) =>
    [...readFileSync(new URL(file, dir), "utf8").matchAll(/\{[^{}\n]*&&\s*(?:\(\s*)?(?:<Row anchor="([\w.]+)"|toggle\("\w+", "([\w.]+)"\))/g)].map((m) => `${file}: ${m[1] ?? m[2]}`),
  );
  assert.deepEqual(wrapped, SHOWN_BY_LOADED_DATA);
});

test("a one-letter query matches setting names, not sections or pane names", () => {
  const titleWords = (id) => SETTINGS_INDEX.find((p) => p.entry.id === id).entry.title.toLowerCase().split(/[^a-z0-9]+/);
  for (const q of ["c", "t", "p"]) {
    const found = ids(q);
    assert.ok(found.length, q);
    for (const id of found) {
      const entry = SETTINGS_INDEX.find((p) => p.entry.id === id).entry;
      assert.ok(titleWords(id).some((w) => w.startsWith(q)) || (entry.keywords ?? []).some((k) => k.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.startsWith(q))), `${q}: ${id}`);
    }
  }
});

test("arrowing through results scrolls only as far as the selected row needs", async () => {
  const { scrollToShow, RESULTS_TOP, RESULTS_BOTTOM } = await import("./searchResultLayout.ts");
  assert.equal(scrollToShow(300, 40, 0, 400, false), 0);
  assert.equal(scrollToShow(500, 40, 0, 400, false), 140 + RESULTS_BOTTOM);
  assert.equal(scrollToShow(500, 70, 0, 400, false), 170 + RESULTS_BOTTOM);
  assert.equal(scrollToShow(100, 40, 200, 400, false), 100 - RESULTS_TOP);
  assert.equal(scrollToShow(260, 40, 200, 400, false), 200);
  assert.equal(scrollToShow(260, 40, 200, 400, true), 0);
});
