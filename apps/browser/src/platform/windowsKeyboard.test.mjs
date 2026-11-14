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

const { mountPage, showPage, callPage, followPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const keyboard = await import("../../../../packages/expo-windows/src/appKeyboard.ts");
const { fieldFocusedIn, notePagePressed, noteFieldAsked, readFocusedFieldWith, takeKeyboardFor, windowIdOfField } = keyboard;

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const shape = { x: 0, y: 0, width: 200, height: 100, radius: 0, holes: [] };
const focusCalls = (key) => calls.filter((call) => call.verb === "tab.call" && call.args.key === key && call.args.method === "focus").map((call) => call.args);
let focused = null;
readFocusedFieldWith(() => focused);
const field = (windowId) => ({ field: { id: windowId }, windowId });

test("a page's show never asks for the keyboard: only a focus or a follow does", async () => {
  const unmount = mountPage("kb-show", { url: "https://a.example/", windowId: "w" }, () => {});
  await settle();
  showPage("kb-show", true, shape);
  showPage("kb-show", true, { ...shape, width: 210 });
  await settle();
  assert.deepEqual(focusCalls("kb-show"), []);
  assert.ok(calls.filter((call) => call.verb === "tab.show" && call.args.key === "kb-show").every((call) => !("fieldFocused" in call.args)));
  unmount();
});

test("a follow asked of a hidden page goes once it shows, and is dropped if a field of its own window took the keyboard meanwhile", async () => {
  focused = null;
  const unmount = mountPage("kb-follow", { url: "https://a.example/", windowId: "w1" }, () => {});
  await settle();
  followPage("kb-follow");
  await settle();
  assert.deepEqual(focusCalls("kb-follow"), [], "a hidden page waits for its show");
  showPage("kb-follow", true, shape);
  await settle();
  assert.deepEqual(focusCalls("kb-follow"), [{ follow: true, key: "kb-follow", method: "focus", deferred: true }]);
  showPage("kb-follow", false, null);
  await settle();
  followPage("kb-follow");
  focused = field("w1");
  showPage("kb-follow", true, { ...shape, width: 220 });
  await settle();
  assert.equal(focusCalls("kb-follow").length, 1, "a field of the page's window has the keyboard: no follow");
  unmount();
  focused = null;
});

test("a field in another window blocks nothing; a field the user left by pressing a page of its window blocks nothing either", async () => {
  focused = field("wA");
  assert.equal(fieldFocusedIn("wA"), true);
  assert.equal(fieldFocusedIn("wB"), false, "a field in window A doesn't hold window B's keyboard");
  const unmount = mountPage("kb-other", { url: "https://a.example/", windowId: "wB" }, () => {});
  await settle();
  showPage("kb-other", true, shape);
  await settle();
  followPage("kb-other");
  await settle();
  assert.deepEqual(focusCalls("kb-other"), [{ key: "kb-other", method: "focus", follow: true }]);
  notePagePressed("wA");
  assert.equal(fieldFocusedIn("wA"), false, "React Native still names the field, but the user pressed a page of its window");
  noteFieldAsked("wA");
  assert.equal(fieldFocusedIn("wA"), true, "the field asked for the keyboard again");
  focused = { field: { id: "?" }, windowId: "" };
  assert.equal(fieldFocusedIn("wB"), true, "a field whose window isn't known holds every window");
  focused = null;
  unmount();
});

test("an explicit focus asked of a hidden page is dropped when a field of its window took the keyboard before the show", async () => {
  const unmount = mountPage("kb-deferred", { url: "https://a.example/", windowId: "w2" }, () => {});
  await settle();
  focused = null;
  await callPage("kb-deferred", "focus");
  focused = field("w2");
  showPage("kb-deferred", true, shape);
  await settle();
  assert.deepEqual(focusCalls("kb-deferred"), []);
  focused = null;
  unmount();
});

test("an app field takes the keyboard only from a page of its own window, and never focuses a field again", async () => {
  const asked = [];
  const native = (moved) => ({ takeKeyboardFromPage: async (windowId) => (asked.push(windowId), moved) });
  assert.equal(await takeKeyboardFor(native(true), "w1"), true);
  assert.equal(await takeKeyboardFor(native(false), "w1"), false);
  assert.equal(await takeKeyboardFor(native(true), ""), false);
  assert.equal(await takeKeyboardFor({ takeKeyboardFromPage: async () => Promise.reject(new Error("no window")) }, "w1"), false);
  assert.deepEqual(asked, ["w1", "w1"], "a field whose window isn't known asks nothing");
  assert.equal(takeKeyboardFor.length, 2, "there is no refocus callback to call a stale field with");
});

test("a field's window is the topmost windowId above it", () => {
  const root = { return: null, memoizedProps: { windowId: "outer" } };
  const inner = { return: root, memoizedProps: { windowId: "w7" } };
  const fieldNode = { __internalInstanceHandle: { return: { return: inner, memoizedProps: { style: {} } }, memoizedProps: {} } };
  assert.equal(windowIdOfField(fieldNode), "outer");
  assert.equal(windowIdOfField(null), "");
});
