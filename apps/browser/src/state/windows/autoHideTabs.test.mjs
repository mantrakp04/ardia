import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { tabsShownIn } = await import("../browser/model.ts");
const { menuState } = await import("../commands/menuState.ts");
const { sidebarMenuItems } = await import("../sidebar/sidebarMenu.ts");
const { flushPersistence, loadSession, parseSession, startPersistence } = await import("../session/persist.ts");
const { SESSION_DOCUMENT } = await import("../session/sessionDocument.ts");
const { noteScroll, useToolbarAutoHide } = await import("./toolbarAutoHide.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const shown = (id) => tabsShownIn(S(), id);
const menuChecked = () => menuState(S()).checked.includes("toggleSidebar");
const sidebarMenuChecked = (id) => !!sidebarMenuItems(S(), id).find((item) => item.id === "autoHide")?.checked;
const everySurface = (ids) => ({ setting: S().settings.autoHideTabs, windows: ids.map(shown), menu: menuChecked(), sidebarMenu: ids.map(sidebarMenuChecked) });
const allShown = (ids) => ({ setting: false, windows: ids.map(() => true), menu: false, sidebarMenu: ids.map(() => false) });
const allHidden = (ids) => ({ setting: true, windows: ids.map(() => false), menu: true, sidebarMenu: ids.map(() => true) });

function fresh() {
  S().hydrate({});
  return S().createWindow({ url: "https://example.com" });
}

test("the setting is the only place that says whether the tabs hide: no window keeps a copy", () => {
  const first = fresh();
  assert.equal("sidebarOpen" in S().windows[first], false);
  assert.deepEqual(everySurface([first]), allShown([first]));
});

test("⌘S, the View menu and the toolbar button flip the setting, and every window follows, in either layout", () => {
  const a = fresh();
  const b = S().createWindow();
  S().toggleTabLayout(b);
  S().toggleSidebar(a);
  assert.ok(S().settingsMeta.chosen.includes("autoHideTabs"));
  assert.deepEqual(everySurface([a, b]), allHidden([a, b]));
  const c = S().createWindow();
  assert.equal(shown(c), false);
  S().toggleSidebar(b);
  assert.deepEqual(everySurface([a, b, c]), allShown([a, b, c]));
  assert.equal(shown(S().createWindow()), true);
});

test("Settings, sync and the config file change the same setting, so the windows can't disagree with it", () => {
  const a = fresh();
  const b = S().createWindow({ kind: "private" });
  S().updateSettings({ autoHideTabs: true });
  assert.deepEqual(everySurface([a, b]), allHidden([a, b]));
  S().updateSettings({ autoHideTabs: false }, { fromSync: true });
  assert.deepEqual(everySurface([a, b]), allShown([a, b]));
  S().updateSettings({ autoHideTabs: true }, { fromSync: true });
  S().toggleSidebar(b);
  assert.deepEqual(everySurface([a, b]), allShown([a, b]));
});

test("with auto-hide off, scrolling a page, switching tabs and closing a tab never hide the tabs", () => {
  for (const layout of ["sidebar", "top"]) {
    const w = fresh();
    if (layout === "top") S().toggleTabLayout(w);
    const first = S().windows[w].tabIds[0];
    const second = S().newTab(w, { url: "https://second.example" });
    const third = S().newTab(w, { url: "https://third.example" });
    noteScroll(third, "down");
    assert.deepEqual(everySurface([w]), allShown([w]), `${layout}: after scrolling`);
    S().activate(first);
    S().activate(second);
    assert.deepEqual(everySurface([w]), allShown([w]), `${layout}: after switching tabs`);
    S().closeTab(second);
    S().closeTab(third);
    assert.deepEqual(everySurface([w]), allShown([w]), `${layout}: after closing tabs`);
    assert.equal(S().settingsMeta.chosen.includes("autoHideTabs"), false, `${layout}: nothing wrote the setting`);
  }
});

test("scrolling tucks the toolbar away only while its own setting is on, and never touches the tabs", () => {
  const w = fresh();
  const tabId = S().windows[w].tabIds[0];
  const tucked = () => !!useToolbarAutoHide.getState().scrolledDown[tabId];
  noteScroll(tabId, "down");
  assert.equal(tucked(), true);
  assert.equal(shown(w), true);
  S().updateSettings({ hideToolbarWhileScrolling: false });
  assert.equal(tucked(), false, "turning it off brings the toolbar back");
  noteScroll(tabId, "down");
  assert.equal(tucked(), false, "off: scrolling leaves the toolbar alone");
  S().updateSettings({ hideToolbarWhileScrolling: true, autoHideTabs: true });
  noteScroll(tabId, "down");
  assert.equal(tucked(), true, "hidden tabs don't stop the toolbar tucking");
});

test("Little Ardia has no tabs to hide and leaves the setting alone", () => {
  fresh();
  const small = S().createWindow({ kind: "small", url: "https://example.com" });
  assert.equal(shown(small), false);
  S().toggleSidebar(small);
  assert.equal(S().settings.autoHideTabs, false);
});

const session = (settings, windows) =>
  JSON.stringify({
    version: 10,
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    profileOrder: ["default"],
    settings,
    windows: windows.map((sidebarOpen, i) => ({ id: `w${i}`, profileId: "default", tabIds: [`t${i}`], activeTabIds: { default: `t${i}` }, sidebarOpen, frame: null, createdAt: 0 })),
    windowOrder: windows.map((_, i) => `w${i}`),
    tabs: windows.map((_, i) => ({ id: `t${i}`, windowId: `w${i}`, profileId: "default", url: "https://example.com" })),
    groups: [],
    splits: [],
    closedTabs: [],
    closedWindows: [],
  });

test("a session from before the setting existed infers it from its windows once", () => {
  assert.equal(parseSession(session({ tabLayout: "top" }, [false, false])).settings.autoHideTabs, true);
  assert.equal(parseSession(session({ tabLayout: "top" }, [false, true])).settings.autoHideTabs, false);
  assert.equal(parseSession(session({ tabLayout: "top" }, [])).settings.autoHideTabs, undefined);
  assert.equal(parseSession(session({ autoHideTabs: false }, [false])).settings.autoHideTabs, false);
});

test("a saved window that hid its tabs while the setting was off comes back with them shown, and is counted", () => {
  const saved = parseSession(session({ tabLayout: "top", autoHideTabs: false }, [false, true]));
  assert.equal(saved.windowsAgainstAutoHideTabs, 1);
  assert.equal("sidebarOpen" in saved.windows.w0, false);
  S().hydrate(saved);
  assert.deepEqual(everySurface(["w0", "w1"]), allShown(["w0", "w1"]));
  assert.equal(parseSession(session({ autoHideTabs: true }, [true, false])).windowsAgainstAutoHideTabs, 1);
  assert.equal(parseSession(session({ autoHideTabs: true }, [false, false])).windowsAgainstAutoHideTabs, 0);
  assert.equal(parseSession(session({ tabLayout: "top" }, [false, false])).windowsAgainstAutoHideTabs, 0);
});

test("hidden or shown survives a quit and relaunch, and the saved windows say the same as the setting", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const a = S().createWindow({ url: "https://a.example" });
  const b = S().createWindow({ url: "https://b.example" });
  const savedWindows = () => JSON.parse(stub.docs.get(SESSION_DOCUMENT)).windows.map((w) => w.sidebarOpen);
  S().toggleSidebar(a);
  flushPersistence();
  assert.deepEqual(savedWindows(), [false, false]);
  S().hydrate(loadSession());
  assert.deepEqual(everySurface([a, b]), allHidden([a, b]));
  S().updateSettings({ autoHideTabs: false });
  flushPersistence();
  assert.deepEqual(savedWindows(), [true, true]);
  const relaunched = loadSession();
  assert.equal(relaunched.windowsAgainstAutoHideTabs, 0);
  S().hydrate(relaunched);
  assert.deepEqual(everySurface([a, b]), allShown([a, b]));
  S().toggleSidebar(a);
  S().closeWindow(a);
  S().toggleSidebar(b);
  S().reopenClosedWindow();
  assert.deepEqual(S().windowOrder.map(shown), [true, true], "a reopened window follows the setting, not how it was closed");
  stop();
});
