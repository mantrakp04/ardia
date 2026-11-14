import assert from "node:assert/strict";
import { test } from "node:test";
import { turboModules } from "../test-native/reactNative.ts";

const calls = [];
let showGate = null;
turboModules.ArdiaEngineHost = {
  available: () => true,
  hostCall: async (verb, argsJson, windowId) => {
    calls.push({ verb, args: JSON.parse(argsJson), windowId });
    if (verb === "tab.show" && showGate) await showGate;
    return JSON.stringify(verb === "tab.create" ? { tab: calls.length } : { ok: true });
  },
  engineCall: async () => "{}",
};

const { mountPage, showPage, callPage, followPage } = await import("../../../../packages/expo-windows/src/engine/pages.ts");
const keyboard = await import("../../../../packages/expo-windows/src/appKeyboard.ts");
const { fieldFocusedIn, notePagePressed, noteFieldAsked, placeOfField, readFocusedFieldWith, takeKeyboardFor, windowIdOfField } = keyboard;

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

const fieldUnder = (...propsFromTop) => {
  let fiber = null;
  for (const memoizedProps of propsFromTop) fiber = { return: fiber, memoizedProps };
  return { __internalInstanceHandle: { return: fiber, memoizedProps: {} } };
};
const WINDOW = { windowId: "w9" };
const PANE = (tabId) => ({ tabId, windowId: "w9", geometry: {}, focused: true });
const REAL_FIELDS = {
  sidebarRename: fieldUnder(WINDOW, { windowId: "w9", section: "list" }, { tabId: "A", section: "list" }, { tabId: "A", onto: null, shift: null }),
  commandBar: fieldUnder(WINDOW, { windowWidth: 1200 }, { variant: "panel", floating: true, tabId: "A", initialText: "" }),
  findBar: fieldUnder(WINDOW, PANE("A"), { tabId: "A", windowId: "w9", width: 600 }, { tabId: "A" }, { tabId: "A", find: {} }),
  newTabSearch: fieldUnder(WINDOW, PANE("A"), { contentAreaOf: "A" }, { tabId: "A", accepting: true }, { tabId: "A", toolbar: true }, { variant: "hero", tabId: "A" }),
  emptyPaneSearch: fieldUnder(WINDOW, PANE("A"), { contentAreaOf: "A" }, { tabId: "A", accepting: true }, { tabId: "A", focused: true }, { placeholder: "Search" }),
  settingsSearch: fieldUnder(WINDOW, PANE("A"), { contentAreaOf: "A" }, { tabId: "A" }, { placeholder: "Search settings" }),
};

test("a field's place: the topmost window and the innermost tab content area, never any tabId above it", () => {
  assert.deepEqual(placeOfField(REAL_FIELDS.sidebarRename), { windowId: "w9", contentAreaOf: "" });
  assert.deepEqual(placeOfField(REAL_FIELDS.commandBar), { windowId: "w9", contentAreaOf: "" });
  assert.deepEqual(placeOfField(REAL_FIELDS.findBar), { windowId: "w9", contentAreaOf: "" });
  assert.deepEqual(placeOfField(REAL_FIELDS.newTabSearch), { windowId: "w9", contentAreaOf: "A" });
  assert.deepEqual(placeOfField(REAL_FIELDS.emptyPaneSearch), { windowId: "w9", contentAreaOf: "A" });
});

test("only a field in the content area of the tab being left yields to the new tab's page; every other field of the window keeps the keyboard", async () => {
  const unmount = mountPage("B", { url: "https://b.example/", windowId: "w9" }, () => {});
  await settle();
  const focusedOn = (name) => (focused = { field: REAL_FIELDS[name], ...placeOfField(REAL_FIELDS[name]) });
  const holds = { sidebarRename: true, commandBar: true, findBar: true, newTabSearch: false, emptyPaneSearch: false, settingsSearch: false };
  for (const [name, held] of Object.entries(holds)) {
    focusedOn(name);
    assert.equal(fieldFocusedIn("w9", "B"), held, `${name} when tab B's page is asked to follow`);
    assert.equal(fieldFocusedIn("w9", "A"), true, `${name} when its own tab's page is asked`);
    assert.equal(fieldFocusedIn("w9"), true, `${name} when the ask names no tab`);
  }
  focusedOn("sidebarRename");
  showPage("B", true, shape);
  await settle();
  followPage("B");
  await settle();
  assert.deepEqual(focusCalls("B"), [], "renaming tab A in the sidebar while tab B is activated keeps the keyboard in the rename field");
  focusedOn("newTabSearch");
  followPage("B");
  await settle();
  assert.deepEqual(focusCalls("B").map((call) => call.follow), [true], "leaving a New Tab page for B moves the keyboard to B");
  focused = null;
  unmount();
});

test("a follow asked before a tab's page exists goes once that page shows, unless another page was asked meanwhile", async () => {
  focused = null;
  followPage("kb-woken");
  await settle();
  assert.deepEqual(focusCalls("kb-woken"), [], "no page yet");
  const unmount = mountPage("kb-woken", { url: "https://woken.example/", windowId: "ww" }, () => {});
  await settle();
  assert.deepEqual(focusCalls("kb-woken"), [], "not before it shows");
  showPage("kb-woken", true, shape);
  await settle();
  assert.deepEqual(focusCalls("kb-woken"), [{ key: "kb-woken", method: "focus", follow: true, deferred: true }]);

  const unmountShown = mountPage("kb-shown", { url: "https://shown.example/", windowId: "ww" }, () => {});
  await settle();
  showPage("kb-shown", true, shape);
  await settle();
  followPage("kb-left");
  followPage("kb-shown");
  const unmountLeft = mountPage("kb-left", { url: "https://left.example/", windowId: "ww" }, () => {});
  await settle();
  showPage("kb-left", true, shape);
  await settle();
  assert.deepEqual(focusCalls("kb-left"), [], "the user went on to another tab before this one's page existed");
  unmount();
  unmountShown();
  unmountLeft();
  await settle();
});

test("a focus waiting for its page's show is dropped when another page is asked while that show is still on its way", async () => {
  focused = null;
  const unmountSlow = mountPage("kb-slow-show", { url: "https://slow.example/", windowId: "ws" }, () => {});
  const unmountClicked = mountPage("kb-clicked", { url: "https://clicked.example/", windowId: "ws" }, () => {});
  await settle();
  showPage("kb-clicked", true, shape);
  await settle();
  await callPage("kb-slow-show", "focus");
  let open;
  showGate = new Promise((resolve) => (open = resolve));
  showPage("kb-slow-show", true, shape);
  await settle();
  await callPage("kb-clicked", "focus");
  showGate = null;
  open();
  await settle();
  assert.deepEqual(focusCalls("kb-slow-show"), [], "the keyboard went to another page meanwhile");
  assert.equal(focusCalls("kb-clicked").length, 1);
  unmountSlow();
  unmountClicked();
  await settle();
});
