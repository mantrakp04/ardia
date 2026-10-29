import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const organize = await import("../pins/tabGrouping.ts");

const S = () => useBrowser.getState();
const short = (id) => (S().tabs[id].url ? S().tabs[id].url.replace(/^https:\/\/|\.com$/g, "") : `new:${id}`);
const order = (w) => S().windows[w].tabIds.map(short);
const shown = (w) => model.activeTabId(S(), w);

const reset = (newTabPosition = "nextToCurrent") => {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition });
};
const setup = (...urls) => {
  const w = S().createWindow({ url: `${urls[0]}.com` });
  const ids = [S().windows[w].tabIds[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `${u}.com` }))];
  S().activate(ids[0]);
  return [w, ...ids];
};
const newTab = (w) => S().newTab(w, { newTabCommand: true });

test("the new tab opens right after the current one and is shown", () => {
  reset();
  const [w, a, b] = setup("a", "b", "c");
  S().activate(b);
  const n = newTab(w);
  assert.deepEqual(order(w), ["a", "b", `new:${n}`, "c"]);
  assert.equal(shown(w), n);
});

test("closing it goes back to the tab it was opened from", () => {
  reset();
  const [w, a, b] = setup("a", "b", "c");
  S().activate(a);
  const n = newTab(w);
  S().closeTab(n);
  assert.equal(shown(w), a);
  S().activate(b);
  const m = newTab(w);
  S().closeTab(m);
  assert.equal(shown(w), b);
});

test("it joins the current tab's group", () => {
  reset();
  const [w, a, b, c] = setup("a", "b", "c", "d");
  const [next, g] = organize.withGroup(S(), [b, c]);
  useBrowser.setState(next);
  S().activate(b);
  const n = newTab(w);
  assert.deepEqual(order(w), ["a", "b", `new:${n}`, "c", "d"]);
  assert.deepEqual(S().groups[g].tabIds, [b, n, c]);
});

test("from a pinned tab it opens first in the list, outside any group", () => {
  reset();
  const [w, a, b] = setup("a", "b", "c");
  const p = S().newTab(w, { url: "p.com", pinned: true });
  S().activate(p);
  const n = newTab(w);
  const regular = S().windows[w].tabIds.filter((id) => !model.inPinnedContainer(S(), id));
  assert.deepEqual(regular.map(short), [`new:${n}`, "a", "b", "c"]);
  assert.equal(organize.groupOf(S(), n), undefined);
  assert.equal(shown(w), n);
  S().closeTab(n);
  assert.equal(shown(w), p);
});

test("it opens after the whole split the current tab is in", () => {
  reset();
  const [w, a, b, c] = setup("a", "b", "c");
  S().createSplit([a, b]);
  S().activate(a);
  const n = newTab(w);
  assert.deepEqual(order(w), ["a", "b", `new:${n}`, "c"]);
  assert.equal(shown(w), n);
});

test("the other choices and other new tabs keep their places", () => {
  reset("bottom");
  let [w, a] = setup("a", "b", "c");
  let n = newTab(w);
  assert.deepEqual(order(w), ["a", "b", "c", `new:${n}`]);

  reset("top");
  [w, a] = setup("a", "b", "c");
  n = newTab(w);
  assert.deepEqual(order(w), [`new:${n}`, "c", "b", "a"]);

  reset();
  [w, a] = setup("a", "b", "c");
  const plain = S().newTab(w, { url: "x.com" });
  assert.deepEqual(order(w), ["a", "b", "c", "x"], "a tab not from New Tab goes to the end");
  assert.equal(S().tabs[plain].openerId, null);
});
