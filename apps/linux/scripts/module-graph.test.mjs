import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "vite";
import { inputAdapters, rawBookmarkAdapter } from "../inputAdapters.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const browser = `${repo}apps/browser/src/`;
const linux = `${root}src/`;

let production;
const productionGraph = () => production ??= (async () => {
  let graph;
  const result = await build({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "error",
    build: { write: false },
    plugins: [{
      name: "ardia-linux:test-module-graph",
      generateBundle() {
        graph = new Map([...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)]));
      },
    }],
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) => output.output).filter((entry) => entry.type === "chunk");
  return { graph, ids: [...graph.keys()], chunks };
})();
const only = (ids, id) => ids.filter((candidate) => candidate.split("?")[0] === id);

test("production graph uses current Linux adapters and one canonical shared state and native module graph", { timeout: 120000 }, async () => {
  const { graph, ids, chunks } = await productionGraph();
  assert.ok(graph?.size > 1000);
  assert.deepEqual(ids.filter((id) => id.includes("/apps/demo/")), []);
  assert.deepEqual(ids.filter((id) => /\/apps\/browser\/src\/(store\/|lib\/(native|tabPages|preload|theme)\.)/.test(id)), []);

  const singletons = [
    `${browser}state/browser/store.ts`,
    `${browser}state/settings/settingsWindows.ts`,
    `${browser}state/tabs/prewarm.ts`,
    `${linux}settingsWindows.ts`,
    `${linux}menus.tsx`,
    `${linux}host.ts`,
    `${linux}shims/expo-modules-core.ts`,
    `${linux}shims/ardiacore.tsx`,
    `${linux}shims/shell.tsx`,
    `${linux}shims/web/HostWebView.tsx`,
    `${linux}shims/web/Symbol.tsx`,
    `${linux}shims/web/symbols/render.ts`,
  ];
  for (const id of singletons) assert.deepEqual(only(ids, id), [id], id);

  const replacements = [
    ["components/sidebar/HoverCard.tsx", "SidebarHoverCard.tsx", ["HoverCard"]],
    ["components/site/SelectionPopover.tsx", "SelectionPopover.tsx", ["SelectionPopover"]],
    ["components/profiles/ProfileIndicator.tsx", "ProfileIndicator.tsx", ["PROFILE_INDICATOR_X", "ProfileIndicator", "useProfileIndicatorWidth"]],
    ["components/sidebar/AddressBar.tsx", "SidebarAddressBar.tsx", ["SidebarAddressRow", "SidebarHeaderTools"]],
    ["components/sidebar/TileFace.tsx", "TileFace.tsx", ["FolderDropRing", "RestingTile", "TILE_RADIUS", "TileFace", "useSlotPosition"]],
    ["state/settings/settingsWindows.ts", "settingsWindows.ts", ["goToSettingsPane", "openImport", "openSettings", "useSettingsNav"]],
    ["components/settings/settingsIndex.ts", "settingsIndex.ts", ["PANES", "SETTINGS_INDEX", "findSetting", "setting", "settingUnavailable"]],
    ["components/settings/Form.tsx", "settingsForm.tsx", ["Anchor", "Group", "Row", "SectionHeader", "SettingsPaneContext"]],
    ["state/engines/engines.ts", "hostEngines.ts", ["canSwitchEngine", "chosenEngine", "defaultEngine", "tabEngine", "siteOf"]],
    ["state/import/apply.ts", "importApply.ts", ["applyResult", "applySafari", "emptyCounts", "importBookmarks"]],
    ["state/extensions/store.ts", "extensionsStore.ts", ["extensionProfile", "shownIn", "useExtensions", "useWindowExtensions", "windowExtensions"]],
  ];
  for (const [shared, adapter, names] of replacements) {
    const id = `${linux}${adapter}`;
    const original = `${browser}${shared}`;
    assert.deepEqual(only(ids, id), [id], adapter);
    for (const name of names) {
      const exports = graph.get(id)?.exports ?? [];
      assert.ok(exports.includes(name) || exports.includes("*") && graph.get(original)?.exports.includes(name), `${adapter}: ${name}`);
    }
    assert.deepEqual(graph.get(original)?.importers, [id], `${shared} is only loaded by its adapter`);
    assert.ok(graph.get(id).importedIds.includes(original));
  }

  const permissions = graph.get(`${browser}state/site/permissions.ts`);
  assert.ok(permissions.importedIds.includes(`${linux}notificationPermission.ts`), "accepting a notification prompt goes through the Linux permission adapter");
  assert.ok(!permissions.importedIds.includes(`${browser}state/site/webNotifications.ts`));
  assert.ok(graph.get(`${linux}notificationPermission.ts`).importedIds.includes(`${browser}state/site/webNotifications.ts`));

  const dock = graph.get(`${browser}components/window/SidebarDock.tsx`);
  assert.ok(dock.importedIds.includes(`${linux}SidebarPeekMark.tsx`), "the docked sidebar marks a peek for the page viewport");
  assert.ok(!dock.importedIds.includes(`${browser}components/sidebar/Sidebar.tsx`));
  assert.ok(graph.get(`${linux}SidebarPeekMark.tsx`).importedIds.includes(`${browser}components/sidebar/Sidebar.tsx`));

  for (const shared of ["state/live/sources.ts", "state/live/net.ts"]) assert.ok(!graph.has(`${browser}${shared}`), `${shared} and its renderer fetch stay out of the Linux bundle`);
  const liveImporters = [
    [`${browser}state/live/engine.ts`, `${linux}liveSources.ts`],
    [`${browser}state/live/googleAuth.ts`, `${linux}liveSources.ts`],
    [`${browser}state/live/googleAuth.ts`, `${linux}liveNet.ts`],
    [`${browser}components/settings/panes/LiveFolders.tsx`, `${linux}liveSources.ts`],
    [`${browser}components/settings/panes/LiveFolders.tsx`, `${linux}liveNet.ts`],
    [`${linux}liveSources.ts`, `${linux}hostLive.ts`],
  ];
  for (const [importer, adapter] of liveImporters) assert.ok(graph.get(importer)?.importedIds.includes(adapter), `${importer} uses ${adapter}`);
  assert.deepEqual(ids.filter((id) => id.split("?")[0] === `${browser}components/import/steps/UnlockStep.tsx`), []);
  assert.deepEqual(ids.filter((id) => id.split("?")[0] === `${linux}LinuxUnlockStep.tsx`), [`${linux}LinuxUnlockStep.tsx`]);
  assert.deepEqual(graph.get(`${linux}LinuxUnlockStep.tsx`)?.importers, [`${browser}components/import/ImportWindow.tsx`]);

  const syncDevice = [
    [`${browser}state/sync/scopeAdapters.ts`, `${browser}platform/sync.ts`],
    [`${browser}platform/sync.ts`, `${linux}shims/sync.tsx`],
    [`${repo}packages/sync/src/native.ts`, `${linux}shims/expo-modules-core.ts`],
  ];
  for (const [importer, imported] of syncDevice) assert.ok(graph.get(importer)?.importedIds.includes(imported), `the sync device name reaches the Linux host: ${importer} imports ${imported}`);

  const coreSuggestFetcher = `${repo}packages/core/src/suggestFetcher.ts`;
  assert.deepEqual(graph.get(coreSuggestFetcher)?.importers, [`${linux}suggestFetcher.ts`]);
  assert.ok(graph.get(`${linux}suggestFetcher.ts`).importedIds.includes(`${linux}hostSuggestions.ts`));

  const lazyModules = [
    ["settings/UtilityWindow", ["UtilityWindow"]],
    ["onboarding/OnboardingOverlay", ["OnboardingOverlay"]],
    ["pages/InternalPage", ["InternalPage"]],
    ["extensions/ExtensionOverlays", ["ExtensionOverlays", "InstallDialogHost"]],
    ["extensions/SidePanel", ["ExtensionSidePanel"]],
    ["bookmarks/BookmarkDialog", ["BookmarkDialog"]],
    ["bookmarks/EditBookmarkDialog", ["EditBookmarkDialog"]],
    ["littleArdia/LittleArdiaWindow", ["LittleArdiaWindow"]],
  ];
  for (const [feature, names] of lazyModules) {
    const original = `${browser}components/${feature}.tsx`;
    const wrapper = `\0ardia-lazy:${original}`;
    const eager = `${original}?ardia-eager`;
    assert.ok(graph.has(wrapper), feature);
    assert.ok(graph.has(eager), feature);
    assert.ok(!graph.has(original), `${feature} has no second eager instance`);
    assert.deepEqual(graph.get(wrapper).exports.toSorted(), names.toSorted());
    for (const name of names) assert.ok(graph.get(eager).exports.includes(name), `${feature}: ${name}`);
    assert.deepEqual(graph.get(wrapper).dynamicallyImportedIds, [eager]);
  }

  const extensionsPane = graph.get(`${browser}components/settings/panes/Extensions.tsx`);
  const lazyOverlays = `\0ardia-lazy:${browser}components/extensions/ExtensionOverlays.tsx`;
  assert.ok(extensionsPane.importedIds.includes(`${linux}SettingsInstallDialog.tsx`), "the Extensions pane hosts its install dialog through the Linux host");
  assert.ok(!extensionsPane.importedIds.includes(lazyOverlays));
  assert.deepEqual(graph.get(`${linux}SettingsInstallDialog.tsx`)?.importers, [`${browser}components/settings/panes/Extensions.tsx`]);
  assert.ok(graph.get(`${linux}SettingsInstallDialog.tsx`).importedIds.includes(lazyOverlays));
  assert.ok(graph.get(`${linux}SettingsInstallDialog.tsx`).importedIds.includes(`${linux}installRequestSheet.ts`));

  const tabDrag = graph.get(`${browser}state/drag/tabDrag.ts`);
  assert.ok(tabDrag.importedIds.includes(`${linux}dragWebviews.ts`), "a tab drag reaches page pictures through the Linux drag preview gate");
  assert.ok(!tabDrag.importedIds.includes(`${browser}platform/webviews.ts`));

  const passwordsPane = graph.get(`${browser}components/settings/panes/Passwords.tsx`);
  assert.ok(passwordsPane.importedIds.includes(`${linux}importedPasswordSave.ts`), "the Passwords pane saves imported handles through the Linux adapter");
  assert.ok(!passwordsPane.importedIds.includes(`${browser}state/site/passwords.ts`));

  for (const id of singletons) assert.equal(chunks.filter((chunk) => id in chunk.modules).length, 1, id);
  assert.ok(graph.get(`${linux}main.tsx`).importedIds.includes(`${browser}state/browser/store.ts`));
  assert.ok(graph.get(`${linux}main.tsx`).importedIds.includes(`${browser}state/tabs/prewarm.ts`));
});

test("production graph selects canonical Live persistence and one shared Live store", { timeout: 120000 }, async () => {
  const { graph, ids, chunks } = await productionGraph();
  const store = `${browser}state/live/store.ts`;
  const binding = `${linux}livePersistence.ts`;
  const defaultBinding = `${browser}platform/livePersistence.ts`;
  assert.deepEqual(only(ids, store), [store]);
  assert.deepEqual(only(ids, binding), [binding]);
  assert.equal(graph.has(defaultBinding), false);
  assert.ok(graph.get(store).importedIds.includes(binding));
  for (const id of [store, binding]) assert.equal(chunks.filter((chunk) => id in chunk.modules).length, 1, id);
  assert.equal(chunks.some((chunk) => defaultBinding in chunk.modules), false);
});

test("production graph routes command state, Settings, sidebar, top tabs and bookmarks through the Linux input boundaries", { timeout: 120000 }, async () => {
  const { graph, ids } = await productionGraph();
  for (const [original, adapter] of inputAdapters) {
    assert.ok(graph.has(adapter), adapter);
    if (adapter.endsWith("clickModifiers.ts")) assert.ok(!graph.has(original), original);
    else {
      assert.ok(graph.get(adapter).importedIds.includes(original), adapter);
      for (const importer of graph.get(original).importers) assert.ok([...inputAdapters.values()].includes(importer), `${original} bypassed by ${importer}`);
    }
    assert.deepEqual(only(ids, adapter), [adapter]);
  }
  const routes = [
    [`${browser}state/commands/commandShortcuts.ts`, "commandCatalog.ts"],
    [`${browser}state/commands/commandShortcuts.ts`, "shortcutFormat.ts"],
    [`${browser}state/settings/paneData.ts`, "shortcutCommands.ts"],
    [`${browser}state/settings/paneData.ts`, "shortcutState.ts"],
    [`${browser}components/settings/panes/Shortcuts.tsx`, "shortcutFormat.ts"],
    [`${browser}components/bookmarks/BarItem.tsx`, "rawBookmarkActions.ts"],
    [`${browser}components/pages/HistoryRow.tsx`, "rawBookmarkActions.ts"],
    [`${linux}menus.tsx`, "shortcutFormat.ts"],
    [`${linux}menus.tsx`, "clickModifiers.ts"],
  ];
  for (const [consumer, adapter] of routes) assert.ok(graph.get(consumer)?.importedIds.includes(`${linux}${adapter}`), consumer);
  assert.ok(graph.get(rawBookmarkAdapter.replacement).importedIds.includes(rawBookmarkAdapter.source));
  assert.deepEqual(graph.get(rawBookmarkAdapter.replacement).importers.toSorted(), [...rawBookmarkAdapter.importers].toSorted());
  for (const consumer of ["components/window/HistoryPopover.tsx", "components/toolbar/NavButtons.tsx", "state/site/selection.ts"]) {
    assert.ok(graph.get(`${browser}${consumer}`).importedIds.includes(rawBookmarkAdapter.source), consumer);
    assert.ok(!graph.get(`${browser}${consumer}`).importedIds.includes(rawBookmarkAdapter.replacement), consumer);
  }
});

const siteConnection = `${browser}components/site/SiteConnection.tsx`;
const siteConnectionAdapter = `${linux}SiteConnection.tsx`;

test("production SiteConnection replacement reaches the real SiteControls and the WebView shim never reaches shared page state", { timeout: 120000 }, async () => {
  const { graph } = await productionGraph();
  assert.deepEqual(graph.get(siteConnection).importers, [siteConnectionAdapter]);
  assert.ok(graph.get(siteConnectionAdapter).importedIds.includes(siteConnection));
  assert.ok(graph.get(`${browser}components/site/SiteControls.tsx`).importedIds.includes(siteConnectionAdapter));
  const webView = `${linux}shims/ardiacore.tsx`;
  const seen = new Set([webView]);
  for (const queue = [webView]; queue.length;) for (const next of graph.get(queue.shift())?.importedIds ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  assert.ok(!seen.has(`${browser}state/tabs/pageState.ts`));
});

test("the Linux connection wrapper renders unknown honestly and delegates every known state and certificate details", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "ardia-site-connection-"));
  const entry = `${root}scripts/.page-state-entry-${process.pid}.tsx`;
  try {
    await writeFile(entry, `import ${JSON.stringify(`${browser}state/browser/store.ts`)};\nimport {createElement} from "react";\nimport {renderToStaticMarkup} from "react-dom/server";\nimport * as linux from ${JSON.stringify(siteConnectionAdapter)};\nimport * as shared from ${JSON.stringify(siteConnection)};\nexport {linux,shared};\nexport const render=(kind,security)=>renderToStaticMarkup(createElement(linux[kind],{security,open:false,onPress:()=>{}}));\n`);
    await build({ root, configFile: `${root}vite.config.ts`, logLevel: "error", ssr: { noExternal: true }, build: { ssr: entry, outDir: directory, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: "fixture.mjs" } } } });
    const fixture = await import(pathToFileURL(join(directory, "fixture.mjs")).href);
    assert.equal(fixture.linux.CertificateDetails, fixture.shared.CertificateDetails);
    for (const security of [null, { level: "none", url: "https://unknown.test", origin: null }]) {
      for (const kind of ["ConnectionChip", "ConnectionRow"]) {
        const html = fixture.render(kind, security);
        assert.match(html, /Connection information unavailable/);
        assert.doesNotMatch(html, /Local Page|local or internal/);
      }
    }
    for (const [level, label] of [["secure", "Secure"], ["local", "Local Page"], ["mixed", "Not Fully Secure"], ["insecure", "Not Secure"], ["certificateError", "Not Secure"]]) {
      const html = fixture.render("ConnectionChip", { level, url: "https://test", origin: "https://test" });
      assert.match(html, new RegExp(label));
      assert.doesNotMatch(html, /information unavailable/);
    }
  } finally {
    await rm(entry, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("Linux shell exports and shared package Expo dialogs use one adapter", () => {
  const script = fileURLToPath(new URL("./dialog-module-production.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /share the production adapter/);
});
