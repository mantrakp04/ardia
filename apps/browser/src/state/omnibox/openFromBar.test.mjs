import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { barSplitsFrom, dispositionFor, openFromBar } = await import("./openFromBar.ts");
const { setOpeningGate } = await import("../tabs/openingGate.ts");
const { splitOf, splitTabIds } = await import("../splits/splits.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

test("⌥↩ is split, ⌘↩ is a new tab, ⇧↩ is a new window", () => {
  assert.equal(dispositionFor({ altKey: true }), "split");
  assert.equal(dispositionFor({ metaKey: true }), "newTab");
  assert.equal(dispositionFor({ shiftKey: true }), "newWindow");
  assert.equal(dispositionFor({ metaKey: true, altKey: true }), "split");
  assert.equal(dispositionFor({}), "current");
});

test("openFromBar with split puts the URL in a right pane beside the tab", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  openFromBar("https://b.com/", a, "split");
  const split = splitOf(S(), a);
  assert.ok(split);
  assert.deepEqual(
    splitTabIds(split).map((id) => S().tabs[id].url),
    ["https://a.com/", "https://b.com/"],
  );
});

test("⌥↩ into a full split opens a background tab instead of dropping the URL", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const b = S().openSplitPane(w, { anchorTabId: a, url: "https://b.com/" }).tabId;
  const c = S().openSplitPane(w, { anchorTabId: b, url: "https://c.com/" }).tabId;
  S().activate(a);
  S().openPanel(w, "https://keep.example/");
  const before = new Set(S().windows[w].tabIds);
  openFromBar("https://d.com/", a, "split");
  assert.deepEqual(
    splitTabIds(splitOf(S(), a)).map((id) => S().tabs[id].url),
    ["https://a.com/", "https://b.com/", "https://c.com/"],
  );
  const added = S().windows[w].tabIds.filter((id) => !before.has(id));
  assert.equal(added.length, 1);
  assert.equal(S().tabs[added[0]].url, "https://d.com/");
  assert.equal(S().tabs[added[0]].openerId, null, "overflow tab is not an opener child");
  assert.equal(activeTabId(S(), w), a, "the new tab stays in the background");
  assert.equal(S().windowUi[w].panel.open, false);
  S().activate(c);
  S().closeTab(c);
  assert.notEqual(activeTabId(S(), w), added[0], "closing the active last pane does not jump to the overflow tab");
  assert.ok([a, b].includes(activeTabId(S(), w)), "focus stays on a remaining split pane");
  assert.ok(splitOf(S(), a));
});

test("⌥↩ asks the opening gate: a rewrite opens the new URL in the pane, a cancel opens nothing", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const asked = [];
  setOpeningGate((url, context) => {
    asked.push(context.via);
    if (url.includes("blocked")) return { cancel: true };
    return Promise.resolve({ url: "https://rewritten.example/" });
  });
  try {
    const before = S().windows[w].tabIds.length;
    openFromBar("https://blocked.example/", a, "split");
    assert.equal(S().windows[w].tabIds.length, before);
    assert.equal(splitOf(S(), a), undefined);
    openFromBar("https://b.com/", a, "split");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      splitTabIds(splitOf(S(), a)).map((id) => S().tabs[id].url),
      ["https://a.com/", "https://rewritten.example/"],
    );
    assert.deepEqual(asked, ["newTab", "newTab"]);
  } finally {
    setOpeningGate(null);
  }
});

test("⌥↩ splits only from a tab showing a page", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const blank = S().newTab(w, {});
  assert.equal(barSplitsFrom(a), true);
  assert.equal(barSplitsFrom(blank), false);
  assert.equal(barSplitsFrom("missing"), false);
});
