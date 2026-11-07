import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { panelTakesFocus } = await import("./sidePanels.ts");

const panel = (extensionId, url) => ({ extensionId, profile: "", pageProfile: "", url });

test("a panel opening on an empty card takes keyboard focus", () => {
  assert.equal(panelTakesFocus(undefined, panel("ext", "chrome-extension://ext/a.html")), true);
});

test("switching to another extension's panel takes keyboard focus", () => {
  assert.equal(panelTakesFocus(panel("one", "chrome-extension://one/a.html"), panel("two", "chrome-extension://two/a.html")), true);
});

test("a tab switch that swaps the panel's page leaves keyboard focus where it is", () => {
  assert.equal(panelTakesFocus(panel("ext", "chrome-extension://ext/a.html"), panel("ext", "chrome-extension://ext/b.html")), false);
});

test("reopening the panel while its card is still on screen keeps the page and its focus", () => {
  assert.equal(panelTakesFocus(panel("ext", "chrome-extension://ext/a.html"), panel("ext", "chrome-extension://ext/a.html")), false);
});

test("a panel closing never takes keyboard focus", () => {
  assert.equal(panelTakesFocus(panel("ext", "chrome-extension://ext/a.html"), undefined), false);
  assert.equal(panelTakesFocus(undefined, undefined), false);
});
