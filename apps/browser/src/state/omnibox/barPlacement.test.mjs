import assert from "node:assert/strict";
import { test } from "node:test";
const { keyBarPlacement, isCentred, commandKeyPlacement, addressFieldShown } = await import("./barPlacement.ts");
const { commandBarPlacementLabel } = await import("../telemetry/track.ts");
const { useBrowser } = await import("../browser/store.ts");

test("⌘L opens at the field when one is on screen, as a click does", () => {
  assert.equal(keyBarPlacement({ setting: "field", small: false, fieldShown: true }), "field");
});

test("⌘L falls back to the centre when no field is on screen", () => {
  assert.equal(keyBarPlacement({ setting: "field", small: false, fieldShown: false }), "centredNoField");
  assert.ok(isCentred("centredNoField"));
});

test("the In the centre setting still sends ⌘L to the centre", () => {
  assert.equal(keyBarPlacement({ setting: "centred", small: false, fieldShown: true }), "centred");
  assert.equal(keyBarPlacement({ setting: "centred", small: false, fieldShown: false }), "centred");
});

test("Little Ardia keeps its own dropdown", () => {
  assert.equal(keyBarPlacement({ setting: "centred", small: true, fieldShown: false }), "field");
});

const S = () => useBrowser.getState();
const pageWindow = (settings) => {
  S().hydrate({});
  S().updateSettings(settings);
  return S().createWindow({ url: "https://example.com/" });
};

test("a click opens at the field whatever the setting", () => {
  const w = pageWindow({ commandBarPlacement: "centred" });
  S().openPanel(w, "https://example.com/");
  assert.equal(S().windowUi[w].panel.placement, "field");
  assert.equal(commandBarPlacementLabel(S().windowUi[w].panel), "field");
});

test("⌘L in each layout", () => {
  let w = pageWindow({ commandBarPlacement: "field", addressBar: "toolbar" });
  assert.equal(commandKeyPlacement(S(), w), "field");
  w = pageWindow({ commandBarPlacement: "field", addressBar: "sidebar", tabLayout: "sidebar", autoHideTabs: false });
  assert.equal(commandKeyPlacement(S(), w), "field");
  w = pageWindow({ commandBarPlacement: "field", addressBar: "sidebar", tabLayout: "sidebar", autoHideTabs: true });
  assert.equal(addressFieldShown(S(), w), false);
  assert.equal(commandKeyPlacement(S(), w), "centredNoField");
  w = pageWindow({ commandBarPlacement: "centred", addressBar: "toolbar" });
  assert.equal(commandKeyPlacement(S(), w), "centred");
});

test("⌘L on a page puts that presentation on the panel", async () => {
  const { runCommand } = await import("../commands/commands.ts");
  const w = pageWindow({ commandBarPlacement: "field", addressBar: "toolbar" });
  runCommand({ command: "focusCommandBar", arg: null, windowId: w });
  assert.equal(S().windowUi[w].panel.open, true);
  assert.equal(S().windowUi[w].panel.placement, "field");
  assert.equal(S().windowUi[w].panel.initialText, "https://example.com/");
});

test("labels the presentation for telemetry", () => {
  assert.equal(commandBarPlacementLabel({ placement: "field" }), "field");
  assert.equal(commandBarPlacementLabel({}), "field");
  assert.equal(commandBarPlacementLabel({ placement: "centred" }), "centred");
  assert.equal(commandBarPlacementLabel({ placement: "centredNoField" }), "centred_no_field");
  assert.equal(commandBarPlacementLabel({ newTab: { kind: "list" }, placement: "field" }), "new_tab");
});

test("an unknown window has no field and ⌘L there goes to the centre", () => {
  const s = useBrowser.getState();
  assert.equal(addressFieldShown(s, "nope"), false);
  assert.equal(commandKeyPlacement(s, "nope"), "centredNoField");
});
