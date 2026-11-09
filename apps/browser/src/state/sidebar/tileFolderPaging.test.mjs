import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { useBrowser } = await import("../browser/store.ts");
const { PageProfileContext } = await import("../browser/hooks.ts");
const folders = await import("../pins/tileFolders.ts");
const { useShownFolderTab, useTileFolderMembers } = await import("../pins/hooks.ts");
const { registerRow } = await import("./sidebarUi.ts");
const { closeFolderPanel, folderPanel, toggleFolderPanel } = await import("./tileFolderUi.ts");

const S = () => useBrowser.getState();

function twoProfilesOneFolderId() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://personal-a.example/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://personal-b.example/" });
  S().pinTabs([a, b], true);
  const { state, folderId } = folders.newTileFolder(S(), [a, b], "Personal");
  useBrowser.setState(state);
  const work = S().createProfile({ name: "Work", shareWith: "default" });
  S().switchProfile(w, work);
  const c = S().newTab(w, { url: "https://work-a.example/" });
  const d = S().newTab(w, { url: "https://work-b.example/" });
  S().pinTabs([c, d], true);
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, ...Object.fromEntries([c, d].map((id) => [id, { ...s.tabs[id], pin: { as: "tile", folder: { id: folderId, name: "Work" } } }])) } }));
  S().activate(c);
  S().switchProfile(w, "default");
  S().activate(a);
  return { w, work, folderId, workTiles: [c, d] };
}

function onPage(profileId, hook) {
  const initial = useBrowser.getInitialState();
  const saved = { ...initial };
  Object.assign(initial, S());
  let out;
  const Probe = () => ((out = hook()), null);
  try {
    renderToStaticMarkup(React.createElement(PageProfileContext.Provider, { value: profileId }, React.createElement(Probe)));
  } finally {
    Object.assign(initial, saved);
  }
  return out;
}

test("a neighbouring page's folder, with the same id 0.2.44 left in both profiles, shows its own tiles and its own shown tile", () => {
  const { w, work, folderId, workTiles } = twoProfilesOneFolderId();
  assert.equal(S().windows[w].profileId, "default");
  assert.deepEqual(onPage(work, () => useTileFolderMembers(w, folderId)), workTiles);
  assert.equal(onPage(work, () => useShownFolderTab(w, folderId)), workTiles[0]);
});

test("a folder panel still measuring when the window pages to another profile doesn't open", async () => {
  const { w, work, folderId } = twoProfilesOneFolderId();
  closeFolderPanel();
  let finish;
  registerRow(w, folderId, { measureInWindow: (done) => (finish = done) });
  const opening = toggleFolderPanel(w, folderId);
  S().switchProfile(w, work);
  finish(8, 100, 64, 48);
  await opening;
  assert.equal(folderPanel(), null);
  registerRow(w, folderId, null);
});
