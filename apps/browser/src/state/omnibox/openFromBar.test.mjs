import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { dispositionFor, openFromBar } = await import("./openFromBar.ts");
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
