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

const { mountPage, showPage, callPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const { appFieldFocused, noteAppFieldFocused, takeKeyboardFor, windowIdOfField } = await import("../../../../packages/expo-windows/src/appKeyboard.ts");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const shape = { x: 0, y: 0, width: 200, height: 100, radius: 0, holes: [] };
const focusCalls = (key) => calls.filter((call) => call.verb === "tab.call" && call.args.key === key && call.args.method === "focus");
const told = [];
const tellHost = (focused) => told.push(focused);

test("a focus asked of a hidden page is dropped when an app field takes the keyboard before the page shows", async () => {
  const unmount = mountPage("kb-deferred", { url: "https://a.example/", windowId: "w" }, () => {});
  await settle();
  noteAppFieldFocused(false, tellHost);
  assert.equal(await callPage("kb-deferred", "focus"), null, "a hidden page's focus waits for its show");
  noteAppFieldFocused(true, tellHost, true);
  showPage("kb-deferred", true, shape);
  await settle();
  await settle();
  assert.deepEqual(focusCalls("kb-deferred"), [], "the page shows but doesn't take the keyboard from the field");
  noteAppFieldFocused(false, tellHost);
  showPage("kb-deferred", false, null);
  await settle();
  await callPage("kb-deferred", "focus");
  showPage("kb-deferred", true, { ...shape, width: 210 });
  await settle();
  await settle();
  assert.deepEqual(focusCalls("kb-deferred").map((call) => call.args), [{ key: "kb-deferred", method: "focus", deferred: true }], "with no field focused, the waiting focus goes after the show, marked deferred so the host can refuse it");
  unmount();
});

test("the engine host hears every time an app field asks for the keyboard, and when the field loses it", () => {
  told.length = 0;
  noteAppFieldFocused(true, tellHost, true);
  noteAppFieldFocused(true, tellHost, true);
  noteAppFieldFocused(true, tellHost);
  noteAppFieldFocused(false, tellHost);
  noteAppFieldFocused(false, tellHost);
  assert.deepEqual(told, [true, true, false]);
  assert.equal(appFieldFocused(), false);
});

test("an app field takes the keyboard only from a page of its own window, and focuses itself again only when it came back", async () => {
  const asked = [];
  const native = (moved) => ({ takeKeyboardFromPage: async (windowId) => (asked.push(windowId), moved) });
  const focused = [];
  await takeKeyboardFor(native(true), "w1", () => focused.push("moved"));
  await takeKeyboardFor(native(false), "w1", () => focused.push("stayed"));
  await takeKeyboardFor(native(true), "", () => focused.push("no window"));
  await takeKeyboardFor({ takeKeyboardFromPage: async () => Promise.reject(new Error("no window")) }, "w1", () => focused.push("failed"));
  assert.deepEqual(focused, ["moved"]);
  assert.deepEqual(asked, ["w1", "w1"], "a field whose window isn't known asks nothing");
});

test("a field's window is the nearest windowId above it", () => {
  const root = { return: null, memoizedProps: { windowId: "outer" } };
  const inner = { return: root, memoizedProps: { windowId: "w7" } };
  const field = { __internalInstanceHandle: { return: { return: inner, memoizedProps: { style: {} } }, memoizedProps: {} } };
  assert.equal(windowIdOfField(field), "outer", "the walk keeps the topmost, the app window's own id");
  assert.equal(windowIdOfField({ __internalInstanceHandle: { return: null, memoizedProps: {} } }), "");
  assert.equal(windowIdOfField(null), "");
});
