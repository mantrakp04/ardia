import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "vite";
import { inputAdapters, rawBookmarkAdapter } from "../inputAdapters.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const shared = fileURLToPath(new URL("../../browser/src/", import.meta.url));
const linux = fileURLToPath(new URL("../src/", import.meta.url));

test("production Vite graph routes command state, Settings, sidebar, top tabs and bookmarks through the Linux input boundaries", { timeout: 60000 }, async () => {
  let graph;
  await build({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "error",
    build: { write: false },
    plugins: [{
      name: "ardia-linux:test-input-boundaries",
      generateBundle() {
        graph = new Map([...this.getModuleIds()].map((id) => [id, this.getModuleInfo(id)]));
      },
    }],
  });
  const ids = [...graph.keys()];
  for (const [original, adapter] of inputAdapters) {
    assert.ok(graph.has(adapter), adapter);
    if (adapter.endsWith("clickModifiers.ts")) assert.ok(!graph.has(original), original);
    else {
      assert.ok(graph.has(original), original);
      assert.ok(graph.get(adapter).importedIds.includes(original), adapter);
      for (const importer of graph.get(original).importers) assert.ok([...inputAdapters.values()].includes(importer), `${original} bypassed by ${importer}`);
    }
    assert.deepEqual(ids.filter((id) => id.split("?")[0] === adapter), [adapter]);
  }
  const routes = [
    ["state/commands/commandShortcuts.ts", "commandCatalog.ts"],
    ["state/commands/commandShortcuts.ts", "shortcutFormat.ts"],
    ["state/settings/paneData.ts", "shortcutCommands.ts"],
    ["state/settings/paneData.ts", "shortcutState.ts"],
    ["components/settings/panes/Shortcuts.tsx", "shortcutFormat.ts"],
    ["components/sidebar/TabRow.tsx", "clickModifiers.ts"],
    ["components/sidebar/PinnedGrid.tsx", "clickModifiers.ts"],
    ["components/tabstrip/TabChip.tsx", "clickModifiers.ts"],
    ["components/tabstrip/PinnedDock.tsx", "clickModifiers.ts"],
    ["components/bookmarks/BarItem.tsx", "rawBookmarkActions.ts"],
    ["components/pages/HistoryRow.tsx", "rawBookmarkActions.ts"],
  ];
  for (const [consumer, adapter] of routes) assert.ok(graph.get(`${shared}${consumer}`)?.importedIds.includes(`${linux}${adapter}`), consumer);
  assert.ok(graph.get(rawBookmarkAdapter.replacement).importedIds.includes(rawBookmarkAdapter.source));
  assert.deepEqual(graph.get(rawBookmarkAdapter.replacement).importers.toSorted(), [...rawBookmarkAdapter.importers].toSorted());
  for (const consumer of ["components/window/HistoryPopover.tsx", "components/toolbar/NavButtons.tsx", "state/site/selection.ts"]) {
    assert.ok(graph.get(`${shared}${consumer}`).importedIds.includes(rawBookmarkAdapter.source), consumer);
    assert.ok(!graph.get(`${shared}${consumer}`).importedIds.includes(rawBookmarkAdapter.replacement), consumer);
  }
  assert.ok(graph.get(`${linux}menus.tsx`).importedIds.includes(`${linux}shortcutFormat.ts`));
  assert.ok(graph.get(`${linux}menus.tsx`).importedIds.includes(`${linux}clickModifiers.ts`));
  assert.deepEqual(ids.filter((id) => id.includes("/apps/demo/")), []);
});
