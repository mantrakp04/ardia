import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { splitsWhereUnavailable, splitTabIdsOf } = await import("./splits.ts");

const S = () => useBrowser.getState();
const split = (id, windowId, tabIds) => ({ id, windowId, orientation: "horizontal", slots: tabIds.map((tabId) => ({ size: 1 / tabIds.length, tabId })) });

test("where Split View is unavailable, a split that arrives drops to its panes and keeps every tab", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const b = S().newTab(w, { url: "https://b.example/", background: true });
  const a = S().windows[w].tabIds[0];
  const splits = { v: split("v", w, [a, b]) };
  assert.deepEqual(splitsWhereUnavailable({ splits }, false), { splits: {} });
  assert.equal(splitsWhereUnavailable({ splits }, true), null);
  assert.equal(splitsWhereUnavailable({ splits: {} }, false), null);
  assert.deepEqual(S().windows[w].tabIds, [a, b]);
});

test("where Split View is available, the slice still makes splits", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const b = S().newTab(w, { url: "https://b.example/", background: true });
  const a = S().windows[w].tabIds[0];
  const id = S().createSplit([a, b]);
  assert.deepEqual(splitTabIdsOf(S().splits[id]), [a, b]);
});
