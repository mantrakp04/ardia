import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const { useBrowser } = await import("../browser/store.ts");
const { splitTabIdsOf } = await import("./splits.ts");

const S = () => useBrowser.getState();
const APP = fileURLToPath(new URL("../../../", import.meta.url));

const ON_WINDOWS = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  return resolved.url.endsWith("/lib/platformFeatures.ts") ? { ...resolved, url: resolved.url.replace(/platformFeatures\\.ts$/, "platformFeatures.windows.ts") } : resolved;
} });`;

const STORE_ON_WINDOWS = `
const { useBrowser } = await import("./src/state/browser/store.ts");
const { splitViewAvailable } = await import("./src/state/splits/splits.ts");
const S = () => useBrowser.getState();
S().hydrate({});
const w = S().createWindow({ url: "https://a.example/" });
const b = S().newTab(w, { url: "https://b.example/", background: true });
const c = S().newTab(w, { url: "https://c.example/", background: true });
const a = S().windows[w].tabIds[0];
const tabs = { ...S().tabs };
const windows = { ...S().windows };
S().hydrate({ tabs, windows, windowOrder: [w], splits: { v: { id: "v", windowId: w, orientation: "horizontal", slots: [{ size: 0.5, tabId: a }, { size: 0.5, tabId: b }] } } });
const restored = { splits: Object.keys(S().splits).length, tabIds: S().windows[w].tabIds };
const created = S().createSplit([a, b]);
const opened = S().openSplitPane(w, { anchorTabId: a, tabId: c });
const openedNew = S().openSplitPane(w, { anchorTabId: a, url: "https://d.example/" });
useBrowser.setState({ splits: { x: { id: "x", windowId: w, orientation: "horizontal", slots: [{ size: 0.5, tabId: a }, { size: 0.5, tabId: c }] } } });
console.log(JSON.stringify({ available: splitViewAvailable, restored, ids: [a, b, c], created, opened, openedNew, setDirectly: Object.keys(S().splits).length, tabCount: S().windows[w].tabIds.length }));
`;

test("on Windows a split in the saved session opens as its panes, none lost, and nothing makes a split", () => {
  const run = spawnSync(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", "--import", `data:text/javascript,${encodeURIComponent(ON_WINDOWS)}`, "--input-type=module", "-e", STORE_ON_WINDOWS], { cwd: APP, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const got = JSON.parse(run.stdout.trim().split("\n").at(-1));
  assert.equal(got.available, false);
  assert.equal(got.restored.splits, 0);
  assert.deepEqual(got.restored.tabIds, got.ids);
  assert.equal(got.created, "");
  assert.deepEqual(got.opened, { ok: false, reason: "unavailable" });
  assert.deepEqual(got.openedNew, { ok: false, reason: "unavailable" });
  assert.equal(got.setDirectly, 0);
  assert.equal(got.tabCount, 3);
});

test("on the Mac the slice still makes splits", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const b = S().newTab(w, { url: "https://b.example/", background: true });
  const a = S().windows[w].tabIds[0];
  const id = S().createSplit([a, b]);
  assert.deepEqual(splitTabIdsOf(S().splits[id]), [a, b]);
});
