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
