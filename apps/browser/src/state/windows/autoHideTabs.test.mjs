import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { chooseAutoHideTabs } = await import("../settings/actions.ts");
const { parseSession } = await import("../session/persist.ts");

const S = () => useBrowser.getState();
const shown = (id) => S().windows[id].sidebarOpen;

function fresh() {
  S().hydrate({});
  return S().createWindow();
}

test("hiding the tabs in one window carries to the next window it opens", () => {
  const first = fresh();
  assert.equal(shown(first), true);
  S().toggleSidebar(first);
  assert.equal(S().settings.autoHideTabs, true);
  assert.ok(S().settingsMeta.chosen.includes("autoHideTabs"));
  const second = S().createWindow();
  assert.equal(shown(second), false);
  S().toggleSidebar(second);
  assert.equal(S().settings.autoHideTabs, false);
  assert.equal(shown(S().createWindow()), true);
});

test("the setting hides or shows the tabs in every open window, in either layout", () => {
  const a = fresh();
  const b = S().createWindow();
  S().toggleTabLayout(b);
  chooseAutoHideTabs(true);
  assert.deepEqual([shown(a), shown(b)], [false, false]);
  chooseAutoHideTabs(false);
  assert.deepEqual([shown(a), shown(b)], [true, true]);
});

test("Little Ardia windows keep their own state and leave the setting alone", () => {
  fresh();
  const small = S().createWindow({ kind: "small", url: "https://example.com" });
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

test("a session from an older build infers the setting from its windows once", () => {
  assert.equal(parseSession(session({ tabLayout: "top" }, [false, false])).settings.autoHideTabs, true);
  assert.equal(parseSession(session({ tabLayout: "top" }, [false, true])).settings.autoHideTabs, false);
  assert.equal(parseSession(session({ tabLayout: "top" }, [])).settings.autoHideTabs, undefined);
  assert.equal(parseSession(session({ autoHideTabs: false }, [false])).settings.autoHideTabs, false);
});
