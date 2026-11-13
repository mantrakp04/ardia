import assert from "node:assert/strict";
import { test } from "node:test";
import { turboModules } from "../test-native/reactNative.ts";

const calls = [];
turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    calls.push({ verb, args: JSON.parse(argsJson), windowId });
    return JSON.stringify(verb === "tab.create" ? { tab: calls.length } : { ok: true });
  },
  engineCall: async () => "{}",
};

const { mountPage, showPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { appFieldFocused, noteAppFieldFocused, takeKeyboardFor } = await import("../../../../packages/expo-windows/src/appKeyboard.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const shape = { x: 0, y: 0, width: 200, height: 100, radius: 0, holes: [] };

test("each show tells the engine host whether an app field has the keyboard, so a page that shows can't take it from the field", async () => {
  const unmount = mountPage("kb-page", { url: "https://a.example/", windowId: "w" }, () => {});
  await settle();
  noteAppFieldFocused(true);
  showPage("kb-page", true, shape);
  await settle();
  noteAppFieldFocused(false);
  showPage("kb-page", true, { ...shape, width: 220 });
  await settle();
  showPage("kb-page", false, null);
  await settle();
  const shows = calls.filter((call) => call.verb === "tab.show").map((call) => call.args);
  assert.equal(shows[0].fieldFocused, true);
  assert.equal(shows[1].fieldFocused, false);
  assert.deepEqual(shows[2], { key: "kb-page", visible: false }, "a hide carries nothing more");
  unmount();
});

test("an app field that asks for the keyboard focuses itself again only when the keyboard came back from a page", async () => {
  const focused = [];
  await takeKeyboardFor({ takeKeyboardFromPage: async () => true }, () => focused.push("moved"));
  await takeKeyboardFor({ takeKeyboardFromPage: async () => false }, () => focused.push("stayed"));
  await takeKeyboardFor({ takeKeyboardFromPage: async () => Promise.reject(new Error("no window")) }, () => focused.push("failed"));
  await takeKeyboardFor({ takeKeyboardFromPage: () => { throw new Error("no module"); } }, () => focused.push("threw"));
  assert.deepEqual(focused, ["moved"]);
  assert.equal(typeof appFieldFocused(), "boolean");
});
