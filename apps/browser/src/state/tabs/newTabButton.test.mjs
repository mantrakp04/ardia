import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { loadSession } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

test("a saved At the top keeps the New Tab button at the top; the other choices leave it at the bottom", () => {
  stub.docs.set("session.json", JSON.stringify({ version: 7, settings: { newTabPosition: "top", chosen: ["newTabPosition"], inferred: [] } }));
  S().hydrate(loadSession());
  assert.equal(S().settings.newTabButtonPosition, "top");
  assert.ok(S().settingsMeta.chosen.includes("newTabButtonPosition"), "it syncs like the choice it came from");
  for (const newTabPosition of ["bottom", "nextToCurrent"]) {
    stub.docs.set("session.json", JSON.stringify({ version: 7, settings: { newTabPosition, chosen: ["newTabPosition"], inferred: [] } }));
  S().hydrate(loadSession());
    assert.equal(S().settings.newTabButtonPosition, "bottom", newTabPosition);
  }
  stub.docs.set("session.json", JSON.stringify({ version: 7, settings: { newTabPosition: "top", newTabButtonPosition: "bottom", chosen: ["newTabPosition", "newTabButtonPosition"], inferred: [] } }));
  S().hydrate(loadSession());
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
