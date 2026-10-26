import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { isPeekTab, peekSourceOf, peekTabId } = await import("./peek.ts");
const { DEFAULT_SETTINGS, peekModifierOf, splitLinkModifierOf } = await import("../settings/settings.ts");
const { stripPlan } = await import("../tabs/liveTabs.ts");
const { viewTabIds } = await import("../browser/model.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const { SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function windowWithTabs() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.example/" });
  const c = S().newTab(w, { url: "https://c.example/", background: true });
  S().activate(a);
  return { w, a, b, c };
}

const order = (w) => S().windows[w].tabIds;

test("a peek is a live tab of the window that stays out of its tab list", () => {
  const { w, a } = windowWithTabs();
  const before = [...order(w)];
  const id = S().openPeek(a, "https://peek.example/page", { x: 100, y: 200 });
  assert.ok(id);
  assert.equal(peekTabId(S(), w), id);
  assert.ok(isPeekTab(S(), id));
  assert.equal(peekSourceOf(S(), id), a);
  assert.equal(S().tabs[id].windowId, w);
  assert.equal(S().tabs[id].navigation.url, "https://peek.example/page");
  assert.equal(S().tabs[id].openerId, a);
  assert.deepEqual(S().peeks[w].from, { x: 100, y: 200 });
  assert.deepEqual(order(w), before);
  assert.ok(!viewTabIds(S(), w).includes(id));
  assert.equal(S().windows[w].activeTabIds.default, a);
});

test("only http(s) links peek, and one peek per window: a new one replaces it", () => {
  const { w, a } = windowWithTabs();
  assert.equal(S().openPeek(a, "file:///etc/hosts"), "");
  assert.equal(S().openPeek(a, "javascript:alert(1)"), "");
  const first = S().openPeek(a, "https://one.example/");
  const second = S().openPeek(a, "https://two.example/");
  assert.notEqual(first, second);
  assert.equal(S().tabs[first], undefined);
  assert.equal(peekTabId(S(), w), second);
});

test("closing a peek throws its page away without a closed-tab entry", () => {
  const { w, a } = windowWithTabs();
  const closed = S().closedTabs.length;
  const id = S().openPeek(a, "https://peek.example/");
  S().closePeek(w);
  assert.equal(S().tabs[id], undefined);
  assert.equal(S().live[id], undefined);
  assert.equal(S().peeks[w], undefined);
  assert.equal(S().closedTabs.length, closed);
  assert.equal(S().windows[w].activeTabIds.default, a);
});

test("Open as Tab keeps the same tab, puts it right after its source and shows it, without reloading", () => {
  const { w, a, b } = windowWithTabs();
  const id = S().openPeek(a, "https://peek.example/");
  S().navigated(id, { url: "https://peek.example/next", title: "Next" }, { isLoading: false, canGoBack: true });
  const moved = S().peekToTab(w);
  assert.equal(moved, id);
  assert.equal(S().peeks[w], undefined);
  assert.deepEqual(order(w).slice(0, 3), [a, id, b]);
  assert.equal(S().windows[w].activeTabIds.default, id);
  assert.equal(S().tabs[id].url, "https://peek.example/next");
  assert.equal(S().tabs[id].navigation.url, "https://peek.example/next");
  assert.equal(S().live[id].canGoBack, true);
  assert.equal(S().tabs[id].openerId, a);
});

test("Open as Tab from a grouped tab joins its group", () => {
  const { w, a, b } = windowWithTabs();
  const group = S().createGroup([a, b]);
  assert.ok(group);
  const id = S().openPeek(a, "https://peek.example/");
  S().peekToTab(w);
  assert.ok(S().groups[group].tabIds.includes(id));
  const ids = order(w);
  assert.ok(ids.indexOf(id) === ids.indexOf(a) + 1);
});

test("Open in Split View: the same tab joins a split with its source", () => {
  const { w, a } = windowWithTabs();
  const id = S().openPeek(a, "https://peek.example/");
  const moved = S().peekToTab(w, { activate: false });
  assert.equal(S().windows[w].activeTabIds.default, a);
  const result = S().openSplitPane(w, { tabId: moved, anchorTabId: a, side: "right" });
  assert.ok(result.ok);
  const split = S().splits[result.splitId];
  assert.deepEqual(split.tabIds, [a, id]);
  assert.equal(S().windows[w].activeTabIds.default, id);
  assert.ok(S().settings.cmdClickCreatesTabGroup);
  assert.ok(!Object.values(S().groups).some((g) => g.tabIds.includes(id) || g.tabIds.includes(a)));
});

test("switching tab closes the peek", () => {
  const { w, a, b } = windowWithTabs();
  const id = S().openPeek(a, "https://peek.example/");
  S().activate(b);
  assert.equal(S().peeks[w], undefined);
  assert.equal(S().tabs[id], undefined);
});

test("the source tab closing or navigating away closes the peek, a same-page hash change doesn't", () => {
  const { w, a } = windowWithTabs();
  let id = S().openPeek(a, "https://peek.example/");
  S().navigated(a, { url: "https://a.example/#section", title: "A" }, {});
  assert.equal(peekTabId(S(), w), id);
  S().navigated(a, { url: "https://a.example/elsewhere", title: "A" }, {});
  assert.equal(S().peeks[w], undefined);
  assert.equal(S().tabs[id], undefined);

  id = S().openPeek(a, "https://peek.example/");
  S().closeTab(a);
  assert.equal(S().peeks[w], undefined);
  assert.equal(S().tabs[id], undefined);
});

test("switching the window's profile closes the peek", () => {
  const { w, a } = windowWithTabs();
  const work = S().createProfile({ name: "Work" });
  const id = S().openPeek(a, "https://peek.example/");
  S().switchProfile(w, work);
  assert.equal(S().peeks[w], undefined);
  assert.equal(S().tabs[id], undefined);
});

test("Little Ardia doesn't peek", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const small = S().createWindow({ small: true, url: "https://small.example/" });
  const tab = S().windows[small].tabIds[0];
  assert.equal(S().openPeek(tab, "https://peek.example/"), "");
});

test("a peek isn't saved with the session and a relaunch restores none", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const { w, a } = windowWithTabs();
  const id = S().openPeek(a, "https://peek.example/");
  flushPersistence();
  stop();
  const saved = loadSession();
  assert.ok(!Object.values(saved.tabs).some((t) => t.id === id || t.url === "https://peek.example/"));
  S().hydrate(saved);
  assert.deepEqual(S().peeks, {});
  assert.equal(S().tabs[id], undefined);
  assert.ok(S().windows[w]);
  stub.docs.clear();
});

test("Chrome's tab strip plan keeps the peek out of the order but makes it Chrome's active tab, so it can take full screen", () => {
  const { w, a, b, c } = windowWithTabs();
  const id = S().openPeek(a, "https://peek.example/");
  const strip = (keys) => ({ strip: 1, window: 1, profile: "default", tabs: keys.map((key, index) => ({ key, browser: index + 1, index, active: key === a, pinned: false })) });
  assert.deepEqual(stripPlan(S(), strip([a, b, c, id])), { keys: [a, b, c], pinned: 0, active: id });
  assert.deepEqual(stripPlan(S(), strip([a, b, c])), { keys: [a, b, c], pinned: 0, active: a });
  S().peekToTab(w);
  assert.deepEqual(stripPlan(S(), strip([a, b, c, id])), { keys: [a, id, b, c], pinned: 0, active: id });
});

test("the Peek modifier setting: ⇧-click by default, ⌥-click or Off, synced, unknown values fall back", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  assert.equal(DEFAULT_SETTINGS.peekModifier, "shift");
  assert.equal(peekModifierOf(S().settings), "shift");
  S().updateSettings({ peekModifier: "alt" });
  assert.equal(peekModifierOf(S().settings), "alt");
  assert.ok(S().settings.chosen.includes("peekModifier"));
  S().updateSettings({ peekModifier: "off" });
  assert.equal(peekModifierOf(S().settings), "off");
  assert.equal(peekModifierOf({ peekModifier: "control" }), "shift");
  assert.equal(peekModifierOf({}), "shift");
  assert.ok(SYNCED_SETTINGS.includes("peekModifier"));
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], settings: { peekModifier: "alt" } });
  assert.equal(peekModifierOf(S().settings), "alt");
});

test("the split link setting: ⌥⇧-click by default or ⌥-click, synced, never on ⌥ together with Peek", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const keys = () => [peekModifierOf(S().settings), splitLinkModifierOf(S().settings)];
  assert.equal(DEFAULT_SETTINGS.splitLinkModifier, "altShift");
  assert.deepEqual(keys(), ["shift", "altShift"]);
  assert.ok(SYNCED_SETTINGS.includes("splitLinkModifier"));
  S().updateSettings({ splitLinkModifier: "alt" });
  assert.deepEqual(keys(), ["shift", "alt"]);
  assert.ok(S().settings.chosen.includes("splitLinkModifier"));
  S().updateSettings({ peekModifier: "alt" });
  assert.deepEqual(keys(), ["alt", "altShift"]);
  assert.equal(S().settings.splitLinkModifier, "altShift");
  S().updateSettings({ splitLinkModifier: "alt" });
  assert.deepEqual(keys(), ["shift", "alt"]);
  S().updateSettings({ peekModifier: "off" });
  assert.deepEqual(keys(), ["off", "alt"]);
  S().updateSettings({ peekModifier: "shift", splitLinkModifier: "altShift" });
  assert.deepEqual(keys(), ["shift", "altShift"]);
  S().updateSettings({ peekModifier: "alt", splitLinkModifier: "alt" }, { fromSync: true });
  assert.deepEqual(keys(), ["alt", "altShift"]);
  assert.equal(splitLinkModifierOf({ splitLinkModifier: "shift" }), "altShift");
  assert.equal(splitLinkModifierOf({}), "altShift");
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], settings: { splitLinkModifier: "alt" } });
  assert.deepEqual(keys(), ["shift", "alt"]);
});

test("another window taking a shared pin's page closes the peek opened from it", () => {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const a = S().createWindow({ url: "https://mail.example/" });
  const [mail] = S().windows[a].tabIds;
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.example/" });
  const id = S().openPeek(mail, "https://peek.example/");
  assert.equal(peekTabId(S(), a), id);
  const copy = viewTabIds(S(), b).find((t) => S().tabs[t].pinned);
  S().activate(copy);
  assert.equal(S().tabs[mail].windowId, b);
  assert.equal(S().peeks[a], undefined);
  assert.equal(S().peeks[b], undefined);
  assert.equal(S().tabs[id], undefined);
});
