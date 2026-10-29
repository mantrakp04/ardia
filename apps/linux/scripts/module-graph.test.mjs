import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const browser = `${repo}apps/browser/src/`;
const linux = `${root}src/`;

test("production graph uses current Linux adapters and one canonical shared state and native module graph", { timeout: 60000 }, async () => {
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
  assert.ok(graph?.size > 1000);
  const ids = [...graph.keys()];
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
  for (const id of singletons) assert.deepEqual(ids.filter((candidate) => candidate.split("?")[0] === id), [id], id);

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
    assert.deepEqual(ids.filter((candidate) => candidate.split("?")[0] === id), [id], adapter);
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

  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) => output.output).filter((entry) => entry.type === "chunk");
  for (const id of singletons) assert.equal(chunks.filter((chunk) => id in chunk.modules).length, 1, id);
  assert.ok(graph.get(`${linux}main.tsx`).importedIds.includes(`${browser}state/browser/store.ts`));
  assert.ok(graph.get(`${linux}main.tsx`).importedIds.includes(`${browser}state/tabs/prewarm.ts`));
});
