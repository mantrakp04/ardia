import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");

const S = () => useBrowser.getState();

test("a saved At the top keeps the New Tab button at the top; the other choices leave it at the bottom", () => {
  S().hydrate({ settings: { newTabPosition: "top", chosen: ["newTabPosition"], inferred: [] } });
  assert.equal(S().settings.newTabButtonPosition, "top");
  assert.ok(S().settings.chosen.includes("newTabButtonPosition"), "it syncs like the choice it came from");
  for (const newTabPosition of ["bottom", "nextToCurrent"]) {
    S().hydrate({ settings: { newTabPosition, chosen: ["newTabPosition"], inferred: [] } });
    assert.equal(S().settings.newTabButtonPosition, "bottom", newTabPosition);
  }
  S().hydrate({ settings: { newTabPosition: "top", newTabButtonPosition: "bottom", chosen: ["newTabPosition", "newTabButtonPosition"], inferred: [] } });
  assert.equal(S().settings.newTabButtonPosition, "bottom", "a saved button position wins");
});

test("the New Tab button and where new tabs open are set independently", () => {
  S().hydrate({});
  S().updateSettings({ newTabPosition: "nextToCurrent" });
  S().updateSettings({ newTabButtonPosition: "top" });
  assert.equal(S().settings.newTabPosition, "nextToCurrent");
  S().updateSettings({ newTabPosition: "bottom" });
  assert.equal(S().settings.newTabButtonPosition, "top");
});
