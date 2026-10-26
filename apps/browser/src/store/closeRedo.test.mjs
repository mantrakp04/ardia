import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { canRedoCloseTab, redoCloseTab, undoCloseTab } = await import("./closeRedo.ts");

const S = () => useBrowser.getState();
const urls = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url);
const shown = (w) => S().tabs[model.activeTabId(S(), w)].url;

function setup(...names) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${names[0]}.com/` });
  const ids = [S().windows[w].tabIds[0], ...names.slice(1).map((n) => S().newTab(w, { url: `https://${n}.com/` }))];
  return [w, ...ids];
}
const tabOf = (w, url) => S().windows[w].tabIds.find((id) => S().tabs[id].url === url);

test("⇧⌘Z closes the tab ⌘Z brought back, and ⌘Z brings it back again", async () => {
  const [w, , b] = setup("a", "b", "c");
  S().closeTab(b);
  assert.equal(canRedoCloseTab(S()), false);
  undoCloseTab(w);
  assert.deepEqual(urls(w), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.equal(shown(w), "https://b.com/");
  assert.equal(canRedoCloseTab(S()), true);
  await redoCloseTab();
  assert.deepEqual(urls(w), ["https://a.com/", "https://c.com/"]);
  assert.equal(canRedoCloseTab(S()), false);
  undoCloseTab(w);
  assert.deepEqual(urls(w), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.equal(canRedoCloseTab(S()), true);
});

test("redo walks back through every tab ⌘Z reopened, newest first", async () => {
  const [w, , b, c] = setup("a", "b", "c", "d");
  S().closeTab(b);
  S().closeTab(c);
  undoCloseTab(w);
  undoCloseTab(w);
  assert.deepEqual(urls(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"]);
  await redoCloseTab();
  assert.deepEqual(urls(w), ["https://a.com/", "https://c.com/", "https://d.com/"]);
  await redoCloseTab();
  assert.deepEqual(urls(w), ["https://a.com/", "https://d.com/"]);
  assert.equal(canRedoCloseTab(S()), false);
  undoCloseTab(w);
  assert.deepEqual(urls(w), ["https://a.com/", "https://c.com/", "https://d.com/"]);
});

test("closing another tab after ⌘Z drops the redo, as any new edit does", async () => {
  const [w, , b, c] = setup("a", "b", "c", "d");
  S().closeTab(b);
  undoCloseTab(w);
  S().closeTab(c);
  assert.equal(canRedoCloseTab(S()), false);
  await redoCloseTab();
  assert.ok(tabOf(w, "https://b.com/"));
  undoCloseTab(w);
  assert.equal(canRedoCloseTab(S()), true);
  await redoCloseTab();
  assert.deepEqual(urls(w), ["https://a.com/", "https://b.com/", "https://d.com/"]);
});

test("⇧⌘T and opening tabs leave nothing to redo, and a tab closed by hand isn't closed twice", async () => {
  const [w, , b] = setup("a", "b", "c");
  S().closeTab(b);
  S().reopenClosed(w);
  assert.equal(canRedoCloseTab(S()), false);
  S().closeTab(tabOf(w, "https://b.com/"));
  undoCloseTab(w);
  S().newTab(w, { url: "https://e.com/" });
  assert.equal(canRedoCloseTab(S()), true);
  S().closeTab(tabOf(w, "https://b.com/"));
  assert.equal(canRedoCloseTab(S()), false);
  await redoCloseTab();
  assert.deepEqual(urls(w), ["https://a.com/", "https://c.com/", "https://e.com/"]);
});

test("a redo the close step declines keeps the tab and the redo", async () => {
  const [w, , b] = setup("a", "b", "c");
  S().closeTab(b);
  undoCloseTab(w);
  await redoCloseTab(async () => {});
  assert.ok(tabOf(w, "https://b.com/"));
  assert.equal(canRedoCloseTab(S()), true);
  await redoCloseTab();
  assert.equal(tabOf(w, "https://b.com/"), undefined);
});

test("a pinned tile ⌘Z reloads in its own window is what ⇧⌘Z closes, wherever ⌘Z was pressed", async () => {
  S().hydrate({});
  const a = S().createWindow({ url: "https://mail.com/" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.com/" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.com/" });
  const [other] = S().windows[b].tabIds;
  S().closeTab(mail);
  const loaded = (id) => !!S().tabs[id]?.navigation || !!S().tabs[id]?.adoptId;
  assert.equal(loaded(mail), false);
  undoCloseTab(b);
  assert.equal(loaded(mail), true);
  assert.equal(canRedoCloseTab(S()), true);
  await redoCloseTab();
  assert.equal(loaded(mail), false, "the tile unloads again");
  assert.ok(S().tabs[other], "B's own tab stays open");
});
