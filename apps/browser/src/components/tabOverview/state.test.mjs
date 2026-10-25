import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const { notePinchScale, pagePinched, pinchedTabCount } = await import("./pinchedPages.ts");

const S = () => useBrowser.getState();

test("a zoomed-in page blocks the overview pinch until it's zoomed back out", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const tab = S().windows[w].activeTabIds[S().windows[w].profileId];
  notePinchScale(tab, 1.6);
  assert.equal(pagePinched(tab), true);
  notePinchScale(tab, 1);
  assert.equal(pagePinched(tab), false);
});

test("navigating away from a zoomed-in page forgets its zoom, even without a zoom event", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const tab = S().windows[w].activeTabIds[S().windows[w].profileId];
  notePinchScale(tab, 1.6);
  S().updateTab(tab, { url: "https://b.example/" });
  assert.equal(pagePinched(tab), false);
});

test("closed tabs don't stay in the zoom list", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const first = S().windows[w].activeTabIds[S().windows[w].profileId];
  const second = S().newTab(w, { url: "https://b.example/" });
  notePinchScale(first, 1.6);
  notePinchScale(second, 1.6);
  S().closeTab(first);
  notePinchScale(second, 1.4);
  assert.equal(pinchedTabCount(), 1);
  assert.equal(pagePinched(first), false);
});
