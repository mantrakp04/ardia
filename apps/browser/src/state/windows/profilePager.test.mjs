import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { pagerFor } = await import("./profilePager.ts");

const S = () => useBrowser.getState();

test("a window that exists keeps one pager; a missing window gets a throwaway that isn't kept", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  assert.equal(pagerFor(w), pagerFor(w));
  assert.notEqual(pagerFor("w-gone"), pagerFor("w-gone"));
});

test("the pages in reach are the shown profile and the ones beside it, and they move with a switch", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const first = S().windows[w].profileId;
  const [b, c, d, e] = ["B", "C", "D", "E"].map((name) => S().createProfile({ name }));
  const reach = () => (pagerFor(w).state.getState().pages ?? []).map((p) => p.id);
  assert.deepEqual(reach(), [first, b]);
  S().switchProfile(w, d);
  assert.deepEqual(reach(), [c, d, e]);
  S().switchProfile(w, e);
  assert.deepEqual(reach(), [d, e]);
});
