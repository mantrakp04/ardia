import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { chromeChanged } = await import("./liveTabs.ts");
const { patchPage } = await import("./pageState.ts");
const { useMedia } = await import("../media/media.ts");
const { startTabReveal } = await import("./tabReveal.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
startTabReveal();
const tab = (id, windowId, url, profileId = "default") => ({
  id, windowId, profileId, url, title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, page: url ? { kind: "loaded", nav: { url, seq: 1 } } : { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const win = (id, tabIds, active, extra = {}) => ({
  id, profileId: "default", kind: "main", tabIds, activeTabIds: { default: active }, sidebarOpen: true, frame: null, createdAt: 0, ...extra,
});
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const setup = (tabs = ["a", "b", "c"], active = "a", more = {}) => {
  const windows = { w1: win("w1", tabs, active), ...(more.windows ?? {}) };
  const all = [...tabs.map((id) => tab(id, "w1", `https://${id}.com/`)), ...(more.tabs ?? [])];
  S().hydrate({ profiles: PROFILES, windows, tabs: Object.fromEntries(all.map((t) => [t.id, t])), focusedWindowId: "w1" });
  for (const t of all) S().updateTab(t.id, { page: { kind: "loaded", nav: { url: t.url, seq: 1 } } });
  stub.revealedTabs.length = 0;
};
const revealed = () => {
  const out = [...stub.revealedTabs];
  stub.revealedTabs.length = 0;
  return out;
};

test("a click or ⌘-number switch shows the page before React commits", () => {
  setup();
  S().activate("b");
  assert.deepEqual(revealed(), ["b"]);
  S().activate("b");
  assert.deepEqual(revealed(), [], "the tab already in front: nothing");
  S().activate("c");
  S().activate("a");
  assert.deepEqual(revealed(), ["c", "a"], "each switch tells the window, so a switch back ends the one before it");
});

test("closing the tab in front shows the one JS picks next", () => {
  setup(["a", "b", "c"], "b");
  S().closeTab("b");
  const next = S().windows.w1.activeTabIds.default;
  assert.ok(next && next !== "b");
  assert.deepEqual(revealed(), [next]);
});

test("a switch Chrome made (DevTools, an extension) is shown once the store follows it", () => {
  setup(["a", "b"], "a");
  const before = { strip: 1, window: 1, profile: "", tabs: [{ key: "a", browser: 1, index: 0, active: true, pinned: false }, { key: "b", browser: 2, index: 1, active: false, pinned: false }] };
  const after = { ...before, tabs: [{ ...before.tabs[0], active: false }, { ...before.tabs[1], active: true }] };
  useBrowser.setState(chromeChanged(S(), before, after, { seen: new Set(["a", "b"]) }));
  assert.equal(S().windows.w1.activeTabIds.default, "b");
  assert.deepEqual(revealed(), ["b"]);
});

test("a switch the native view can't show by itself ends any reveal in that window instead", () => {
  setup(["a", "b", "c", "d", "e", "f"], "a");
  S().updateTab("b", { page: { kind: "asleep" } });
  S().activate("b");
  assert.deepEqual(revealed(), ["drop over a"], "a sleeping tab wakes through React");
  S().activate("a");
  assert.deepEqual(revealed(), ["a"]);
  S().updateTab("c", { url: "", page: { kind: "idle" } });
  S().activate("c");
  assert.deepEqual(revealed(), ["drop over a"], "a New Tab page");
  S().activate("a");
  revealed();
  patchPage("d", { newTabShown: { url: "", title: "", favicon: null } });
  S().activate("d");
  assert.deepEqual(revealed(), ["drop over a"], "a page under the New Tab page");
  patchPage("d", { newTabShown: null });
  S().activate("a");
  revealed();
  patchPage("e", { crashed: { status: 1, reason: "crashed", code: 0 } });
  S().activate("e");
  assert.deepEqual(revealed(), ["drop over a"], "a crashed page, which shows the sad tab over it");
  patchPage("e", { crashed: null });
  S().activate("a");
  revealed();
  useMedia.setState({ tabShares: { f: { dismissed: {} } } });
  S().activate("f");
  assert.deepEqual(revealed(), ["drop over a"], "while a tab is shared, the share bar changes the page's height");
  useMedia.setState({ tabShares: {} });
  S().activate("a");
  revealed();
  patchPage("a", { fullscreen: true });
  S().activate("d");
  assert.deepEqual(revealed(), ["drop over a"], "leaving a full-screen page");
  patchPage("a", { fullscreen: false });
});

test("splits and profile switches are left to React", () => {
  setup(["a", "b", "c"], "a");
  S().createSplit(["b", "c"]);
  revealed();
  S().activate("b");
  assert.deepEqual(revealed(), ["drop over a"], "into a split");
  S().activate("a");
  assert.deepEqual(revealed(), ["drop over b"], "out of a split");
  setup(["a", "b"], "a");
  useBrowser.setState((s) => ({
    tabs: { ...s.tabs, b: { ...s.tabs.b, profileId: "work" } },
    windows: { ...s.windows, w1: { ...s.windows.w1, profileId: "work", activeTabIds: { default: "a", work: "b" } } },
  }));
  assert.deepEqual(revealed(), ["drop over a"], "another profile's page");
});

test("a tab moved in from another window and shown there is left to React", () => {
  setup(["a"], "a", { windows: { w2: win("w2", ["x", "y"], "x") }, tabs: [tab("x", "w2", "https://x.com/"), tab("y", "w2", "https://y.com/")] });
  S().moveTabsToWindow(["y"], "w1");
  assert.equal(S().windows.w1.activeTabIds.default, "y");
  assert.ok(!revealed().includes("y"), "its view still sits in the window it leaves");
});

test("a page Chrome opened in front (a link's new tab, DevTools, an extension) is shown over the page it replaces", () => {
  setup(["a", "b"], "a");
  const made = S().newTab("w1", { url: "https://made.example/", adoptId: "tab:5" });
  assert.deepEqual(revealed(), ["tab:5 over a"]);
  assert.equal(S().windows.w1.activeTabIds.default, made);
  S().newTab("w1", { url: "https://behind.example/", adoptId: "tab:6", background: true });
  assert.deepEqual(revealed(), [], "in the background");
  S().newTab("w1", { url: "https://dup.example/", adoptId: "clone:a" });
  assert.deepEqual(revealed(), [`drop over ${made}`], "a duplicate made from a tab");
  S().activate("b");
  revealed();
  patchPage("b", { newTabShown: { url: "", title: "", favicon: null } });
  S().newTab("w1", { url: "https://other.example/", adoptId: "tab:7" });
  assert.deepEqual(revealed(), ["drop over b"], "over a New Tab page");
  patchPage("b", { newTabShown: null });
});

test("a new tab isn't shown over a page whose toolbar is scrolled away (its page is taller than the new tab's)", async () => {
  const { useToolbarAutoHide } = await import("../windows/toolbarAutoHide.ts");
  setup(["a"], "a");
  useToolbarAutoHide.setState({ scrolledDown: { a: true } });
  S().newTab("w1", { url: "https://made.example/", adoptId: "tab:8" });
  assert.deepEqual(revealed(), ["drop over a"]);
  useToolbarAutoHide.setState({ scrolledDown: {} });
});
