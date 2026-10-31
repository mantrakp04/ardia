import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { activeTabId } from "../browser/model.ts";
import { recentTabIds } from "../pins/tabCleanup.ts";
import { sidebarUi } from "./sidebarUi.ts";
import { cancelSwitcher, commitSwitcher, moveSwitcher, switcherStep } from "./switcher.ts";

const S = () => useBrowser.getState();
afterEach(cancelSwitcher);

function setup() {
  cancelSwitcher();
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const window = S().createWindow({ url: "https://personal.example" });
  const personal = activeTabId(S(), window);
  const second = S().newTab(window, { url: "https://second.example", background: true });
  const other = S().newTab(window, { url: "https://work.example", profileId: work, background: true });
  const now = Date.now();
  S().updateTab(personal, { lastActiveAt: now - 20 });
  S().updateTab(second, { lastActiveAt: now - 30 });
  S().updateTab(other, { lastActiveAt: now - 10 });
  return { work, window, personal, second, other };
}

test("default scope stays in the current profile and puts its active tab first", () => {
  const { window, personal, second } = setup();
  assert.equal(S().settings.tabSwitcherScope, "currentProfile");
  assert.deepEqual(recentTabIds(S(), window), [personal, second]);
});

test("all profiles uses window MRU and commits across profiles only when released", () => {
  const { window, personal, other, work } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  switcherStep(window, false);
  assert.equal(sidebarUi().switcher.ids[1], other);
  assert.equal(activeTabId(S(), window), personal);
  assert.equal(S().windows[window].profileId, "default");
  commitSwitcher();
  assert.equal(activeTabId(S(), window), other);
  assert.equal(S().windows[window].profileId, work);
  switcherStep(window, false);
  commitSwitcher();
  assert.equal(activeTabId(S(), window), personal);
});

test("cycling and cancel leave selection and unloaded background pages alone", () => {
  const { window, personal, other } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  S().updateTab(other, { page: { kind: "idle" } });
  switcherStep(window, false);
  const ids = sidebarUi().switcher.ids;
  S().updateTab(personal, { lastActiveAt: Date.now() + 100 });
  S().newTab(window, { url: "https://later.example", background: true });
  moveSwitcher(1);
  assert.deepEqual(sidebarUi().switcher.ids, ids);
  cancelSwitcher();
  assert.equal(activeTabId(S(), window), personal);
  assert.equal(S().tabs[other].page.kind, "idle");
});

test("closing the highlighted tab advances in the frozen order and skips it", () => {
  const { window, other, second } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  switcherStep(window, false);
  S().closeTab(other);
  assert.deepEqual(sidebarUi().switcher.ids.length, 2);
  assert.equal(sidebarUi().switcher.ids[sidebarUi().switcher.index], second);
  commitSwitcher();
  assert.equal(activeTabId(S(), window), second);
});

test("private windows and other windows never enter the candidates", () => {
  const { window, work } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  const regular = S().createWindow({ profileId: work, url: "https://elsewhere.example" });
  const privateWindow = S().createWindow({ kind: "private", url: "https://private.example" });
  const privateTab = activeTabId(S(), privateWindow);
  const privateSecond = S().newTab(privateWindow, { url: "https://private2.example", background: true });
  assert.deepEqual(recentTabIds(S(), privateWindow), [privateTab, privateSecond]);
  const ids = recentTabIds(S(), window);
  assert.ok(!ids.includes(privateTab));
  assert.ok(!ids.includes(activeTabId(S(), regular)));
});

test("closed pins are excluded and recency keeps the first two eligible tabs", () => {
  const { window, personal, other, second } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  S().togglePin(second);
  S().closeTab(second);
  S().updateTab(personal, { lastActiveAt: 1 });
  S().updateTab(other, { lastActiveAt: 2 });
  const stale = S().newTab(window, { url: "https://stale.example", background: true });
  S().updateTab(stale, { lastActiveAt: 0 });
  assert.deepEqual(recentTabIds(S(), window), [personal, other]);
});

test("backward wraps and closing the window cancels the selector", () => {
  const { window, second } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  switcherStep(window, true);
  assert.equal(sidebarUi().switcher.ids[sidebarUi().switcher.index], second);
  S().closeWindow(window);
  assert.equal(sidebarUi().switcher, null);
});

test("moving a candidate to another profile removes it in current-profile scope", () => {
  const { window, second, work } = setup();
  switcherStep(window, false);
  S().moveTabToProfile(second, work);
  assert.ok(!sidebarUi().switcher?.ids.includes(second));
});

test("moving a candidate to another window removes it before commit", () => {
  const { window, other } = setup();
  S().updateSettings({ tabSwitcherScope: "allProfiles" });
  const destination = S().createWindow({ url: "https://destination.example" });
  switcherStep(window, false);
  S().moveTabsToWindow([other], destination);
  assert.ok(!sidebarUi().switcher.ids.includes(other));
  const selected = sidebarUi().switcher.ids[sidebarUi().switcher.index];
  commitSwitcher();
  assert.equal(activeTabId(S(), window), selected);
});

for (const kind of ["row", "group"]) {
  test(`a restored selected pinned ${kind} in a background profile remains eligible`, () => {
    const { window, work, personal, other } = setup();
    S().updateSettings({ tabSwitcherScope: "allProfiles" });
    if (kind === "row") S().pinTabs([other], true, true);
    else S().updateGroup(S().createGroup([other]), { pinned: true });
    S().updateTab(other, { page: { kind: "idle" } });
    assert.equal(activeTabId(S(), window, work), other);
    assert.equal(activeTabId(S(), window), personal);
    assert.ok(recentTabIds(S(), window).includes(other));
    switcherStep(window, false);
    assert.equal(sidebarUi().switcher.ids[sidebarUi().switcher.index], other);
    assert.equal(S().tabs[other].page.kind, "idle");
    commitSwitcher();
    assert.equal(S().windows[window].profileId, work);
    assert.equal(activeTabId(S(), window), other);
    assert.equal(S().tabs[other].page.kind, "loaded");
  });

  test(`an explicitly unloaded pinned ${kind} stays excluded even when its profile remembers it`, () => {
    const { window, work, other } = setup();
    S().updateSettings({ tabSwitcherScope: "allProfiles" });
    if (kind === "row") S().pinTabs([other], true, true);
    else S().updateGroup(S().createGroup([other]), { pinned: true });
    S().updateTab(other, { page: { kind: "asleep" } });
    assert.equal(activeTabId(S(), window, work), other);
    assert.ok(!recentTabIds(S(), window).includes(other));
  });
}
