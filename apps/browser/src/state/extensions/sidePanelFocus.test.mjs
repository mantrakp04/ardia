import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { pendingPanelFocus, sidePanelKey } = await import("./sidePanels.ts");

const panel = (extensionId, url, pageProfile = "") => ({ extensionId, profile: "", pageProfile, url });
const one = panel("one", "chrome-extension://one/a.html");
const oneOther = panel("one", "chrome-extension://one/b.html");
const two = panel("two", "chrome-extension://two/a.html");

test("a panel opening on an empty card asks for keyboard focus on its page", () => {
  assert.equal(pendingPanelFocus(null, undefined, one), sidePanelKey(one));
});

test("switching to another extension's panel asks for keyboard focus on its page", () => {
  assert.equal(pendingPanelFocus(null, one, two), sidePanelKey(two));
});

test("a tab switch that swaps the panel's page leaves keyboard focus where it is", () => {
  assert.equal(pendingPanelFocus(null, one, oneOther), null);
});

test("a tab switch before the opened panel finishes loading drops the pending focus", () => {
  const pending = pendingPanelFocus(null, undefined, one);
  assert.equal(pendingPanelFocus(pending, one, oneOther), null);
});

test("a profile change of the same page before the first load drops the pending focus", () => {
  const pending = pendingPanelFocus(null, undefined, one);
  assert.equal(pendingPanelFocus(pending, one, panel("one", one.url, "other")), null);
});

test("the pending focus belongs to the page it was asked for", () => {
  assert.notEqual(sidePanelKey(one), sidePanelKey(oneOther));
  assert.notEqual(sidePanelKey(one), sidePanelKey(panel("one", one.url, "other")));
  assert.notEqual(sidePanelKey(one), sidePanelKey(two));
});

test("reopening the panel while its card is still on screen keeps the page and its focus", () => {
  assert.equal(pendingPanelFocus(null, one, one), null);
});

test("a panel closing clears any pending focus", () => {
  assert.equal(pendingPanelFocus(sidePanelKey(one), one, undefined), null);
  assert.equal(pendingPanelFocus(null, undefined, undefined), null);
});
