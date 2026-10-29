import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { webviewRef, webviews } = await import("../../platform/webviews.ts");
const { takeStartedNavigation } = await import("./earlyNavigate.ts");

const S = () => useBrowser.getState();
const loads = [];
const handle = () => ({ loadUrl: async (url, options) => void loads.push({ url, userInitiated: !!options?.userInitiated }) });
const setup = () => {
  const tab = {
    id: "a", windowId: "w1", profileId: "default", url: "https://a.com/", title: "", favicon: null, pin: null, muted: false, zoom: 1,
    customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "loaded", nav: { url: "https://a.com/", seq: 1 } }, openerId: null, createdAt: 0, lastActiveAt: 0,
  };
  const win = { id: "w1", profileId: "default", kind: "main", tabIds: ["a"], activeTabIds: { default: "a" }, sidebarOpen: true, frame: null, createdAt: 0 };
  S().hydrate({ profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, windows: { w1: win }, tabs: { a: tab }, focusedWindowId: "w1" });
  webviews.clear();
  loads.length = 0;
  const ref = webviewRef("a");
  ref(handle());
  return ref;
};
const rerender = (ref) => {
  ref(null);
  ref(handle());
};

test("a navigation starts in the store action, once, and its view effect skips it", () => {
  setup();
  S().navigate("a", "https://b.com/");
  const seq = S().tabs.a.page.nav.seq;
  assert.deepEqual(loads, [{ url: "https://b.com/", userInitiated: true }]);
  assert.equal(takeStartedNavigation("a", seq), true);
  assert.equal(takeStartedNavigation("a", seq), false);
});

test("a re-render that hands the same view a new handle object still skips the second load", () => {
  const ref = setup();
  S().navigate("a", "https://b.com/");
  const seq = S().tabs.a.page.nav.seq;
  rerender(ref);
  assert.equal(takeStartedNavigation("a", seq), true);
  assert.equal(loads.length, 1);
});

test("a view that remounted after the start loads the page itself", () => {
  const ref = setup();
  S().navigate("a", "https://b.com/");
  const seq = S().tabs.a.page.nav.seq;
  webviewRef("a")(handle());
  ref(null);
  assert.equal(takeStartedNavigation("a", seq), false);
});

test("an older navigation's start doesn't cover a newer one", () => {
  setup();
  S().navigate("a", "https://b.com/");
  assert.equal(takeStartedNavigation("a", S().tabs.a.page.nav.seq + 1), false);
});

test("with no view yet, the view effect loads as before", () => {
  const ref = setup();
  ref(null);
  S().navigate("a", "https://b.com/");
  assert.equal(loads.length, 0);
  assert.equal(takeStartedNavigation("a", S().tabs.a.page.nav.seq), false);
});
