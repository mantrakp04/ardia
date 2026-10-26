import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { recentTabIds } = await import("./organize.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".com", "");

function windowWith(...names) {
  const w = S().createWindow({ url: `https://${names[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of names.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

test("⌃Tab leaves out pinned tabs that were closed, and lists them again once reopened", () => {
  S().hydrate({});
  const { w, ids: [figma, notes, mail, docs] } = windowWith("figma", "notes", "mail", "docs");
  S().pinTabs([figma], true);
  S().pinTabs([notes], true, true);
  for (const id of [docs, mail, notes, figma]) S().activate(id);
  S().closeTab(figma);
  S().activate(notes);
  S().closeTab(notes);
  assert.deepEqual(recentTabIds(S(), w).map(host).sort(), ["docs", "mail"]);
  S().activate(figma);
  assert.deepEqual(recentTabIds(S(), w).map(host), ["figma", "mail", "docs"]);
});

test("⌃Tab still lists a closed list tab's neighbours and every open pinned tab", () => {
  S().hydrate({});
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  for (const id of [c, b, a]) S().activate(id);
  S().closeTab(b);
  assert.deepEqual(recentTabIds(S(), w).map(host), ["a", "c"]);
});
