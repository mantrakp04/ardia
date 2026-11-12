import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const entries = await import("./entries.ts");
const { entriesHeight, entryHeight, rowSpan } = await import("./geometry.ts");
const { GROUP_MEMBERS_PAD_BOTTOM } = await import("../../lib/sidebarMetrics.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const profile = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const tab = (i) => ({
  id: `t${i}`, windowId: "w", profileId: "default", url: `https://example.com/${i}`, title: `Tab ${i}`, favicon: null, pinned: false,
  muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: i, lastActiveAt: i,
});
const group = (id, tabIds, extra = {}) => ({ id, windowId: "w", profileId: "default", name: id, icon: null, color: null, collapsed: true, pinned: false, tabIds, createdAt: 0, ...extra });

function hydrate({ nested = null, pinned = false } = {}) {
  const tabs = Array.from({ length: 12 }, (_, i) => tab(i));
  S().hydrate({
    profiles: { default: profile },
    windows: { w: { id: "w", profileId: "default", kind: "main", tabIds: tabs.map((t) => t.id), activeTabIds: { default: "t0" }, sidebarOpen: true, frame: [0, 0, 1200, 800], createdAt: 0 } },
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
    groups: {
      g: group("g", ["t2", "t3", "t4", "t5", "t6"], { pinned }),
      ...(nested ? { n: group("n", nested, { parentId: "g", pinned }) } : {}),
    },
  });
}

const kept = (groupId = "g") => entries.keptEntries(S(), "w", "default", groupId);
const height = (entry = "g:g") => entryHeight(S(), "w", "default", entry);
const rowGap = () => entriesHeight(S(), "w", "default", ["t:t0", "t:t1"]) - 2 * height("t:t0");

test("tabs opened from a collapsed group stay under its header after focus moves away", () => {
  hydrate();
  const bare = height();
  S().activate("t3");
  S().activate("t5");
  S().activate("t0");
  assert.equal(height(), bare + 2 * height("t:t0") + rowGap() + GROUP_MEMBERS_PAD_BOTTOM);
  assert.deepEqual(kept(), ["t:t3", "t:t5"]);
  assert.equal(S().groups.g.collapsed, true);
});

test("a background tab opened from a collapsed group joins it under the header", () => {
  hydrate();
  const id = S().newTab("w", { url: "https://example.com/opened", openerId: "t3", background: true });
  assert.ok(S().groups.g.tabIds.includes(id));
  assert.equal(S().windows.w.activeTabIds.default, "t0");
  assert.deepEqual(kept(), [`t:${id}`]);
});

test("a header click hides every kept tab but the focused one, and the group stays collapsed", () => {
  hydrate();
  S().activate("t3");
  S().activate("t5");
  S().updateGroup("g", { shownTabIds: [] });
  assert.deepEqual(kept(), ["t:t5"]);
  assert.equal(S().groups.g.collapsed, true);
  S().activate("t0");
  assert.deepEqual(kept(), []);
  S().updateGroup("g", { shownTabIds: [] });
  assert.deepEqual(kept(), []);
  assert.equal(S().groups.g.shownTabIds, undefined);
});

test("expanding or collapsing starts over with only the focused tab", () => {
  hydrate();
  S().updateGroup("g", { collapsed: false });
  S().activate("t3");
  S().activate("t4");
  S().updateGroup("g", { collapsed: true });
  assert.deepEqual(kept(), ["t:t4"]);
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t4"]);
  S().activate("t5");
  S().updateGroup("g", { collapsed: false });
  S().updateGroup("g", { collapsed: true });
  assert.deepEqual(kept(), ["t:t5"]);
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t5"]);
});

test("closing a kept tab removes it from under the header", () => {
  hydrate();
  S().activate("t3");
  S().activate("t5");
  S().activate("t0");
  S().closeTab("t3");
  assert.deepEqual(kept(), ["t:t5"]);
});

test("in a pinned group, unloading a kept tab takes it off the header", () => {
  hydrate({ pinned: true });
  S().activate("t3");
  S().activate("t5");
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t3", "t:t5"]);
  S().closeTab("t3");
  assert.ok(S().groups.g.tabIds.includes("t3"));
  assert.deepEqual(kept(), ["t:t5"]);
});

test("a collapsed group inside a collapsed group keeps its own opened tabs, and the outer one shows the group", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t3");
  S().activate("t4");
  S().activate("t5");
  S().activate("t0");
  assert.deepEqual(kept("g"), ["t:t3", "g:n"]);
  assert.deepEqual(kept("n"), ["t:t4", "t:t5"]);
  S().updateGroup("n", { shownTabIds: [] });
  assert.deepEqual(kept("n"), []);
  assert.deepEqual(kept("g"), ["t:t3", "g:n"]);
});

const shows = (groupId = "g") => entries.showsExtraTabs(S(), "w", "default", groupId);

test("an outer header sees the extra tabs a collapsed group inside it reveals, and one click hides them", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t4");
  S().activate("t5");
  assert.deepEqual(kept("g"), ["g:n"]);
  assert.deepEqual(kept("n"), ["t:t4", "t:t5"]);
  assert.equal(shows("g"), true);
  S().updateGroup("g", { shownTabIds: [] });
  assert.deepEqual(kept("n"), ["t:t5"]);
  assert.equal(shows("g"), false);
  assert.equal(S().groups.g.collapsed, true);
});

test("a header with only the focused tab under it has no extra tabs to hide", () => {
  hydrate({ nested: ["t4", "t5"] });
  assert.equal(shows("g"), false);
  S().activate("t5");
  assert.equal(shows("g"), false);
  assert.equal(shows("n"), false);
  S().activate("t0");
  assert.equal(shows("g"), true);
});

test("a group expanded and collapsed again by the Chrome-side sync starts over with only the focused tab", () => {
  hydrate();
  S().activate("t3");
  S().activate("t5");
  const set = (collapsed) => useBrowser.setState((s) => ({ groups: { ...s.groups, g: { ...s.groups.g, collapsed } } }));
  set(false);
  assert.equal(S().groups.g.shownTabIds, undefined);
  set(true);
  assert.deepEqual(kept(), ["t:t5"]);
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t5"]);
});

test("a tab opened with the New Tab command beside a tab of a collapsed group stays under its header", () => {
  hydrate();
  useBrowser.setState((s) => ({ settings: { ...s.settings, newTabPosition: "nextToCurrent" } }));
  S().activate("t3");
  const id = S().newTab("w", { newTabCommand: true });
  assert.ok(S().groups.g.tabIds.includes(id));
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t3", `t:${id}`]);
});

test("an Opt+Shift-click that opens a tab in the focused collapsed group keeps it under the header", () => {
  hydrate();
  useBrowser.setState((s) => ({ settings: { ...s.settings, optShiftClickOpensInGroup: true } }));
  S().activate("t3");
  S().clickTab("w", "t1", { altKey: true, shiftKey: true });
  assert.ok(S().groups.g.tabIds.includes("t1"));
  S().activate("t0");
  assert.deepEqual(kept(), ["t:t3", "t:t1"]);
});

test("a tab added to a collapsed group by addTabsToGroup stays under its header", () => {
  hydrate();
  S().addTabsToGroup("g", ["t1"]);
  assert.ok(S().groups.g.tabIds.includes("t1"));
  assert.equal(S().windows.w.activeTabIds.default, "t0");
  assert.deepEqual(kept(), ["t:t1"]);
});

test("a tab dragged into a collapsed group is placed there hidden, like Arc's", () => {
  hydrate();
  S().placeTabs(["t1"], { pinned: false, groupId: "g" });
  assert.ok(S().groups.g.tabIds.includes("t1"));
  assert.deepEqual(kept(), []);
});

test("each tab kept under a collapsed header has its own row position, one row gap apart", () => {
  hydrate();
  S().activate("t3");
  S().activate("t5");
  S().activate("t0");
  const row = height("t:t0");
  const first = rowSpan(S(), "w", "default", "t3", false);
  const second = rowSpan(S(), "w", "default", "t5", false);
  assert.equal(first.top, 2 * (row + rowGap()) + 0.5 + row);
  assert.equal(second.top, first.top + row + rowGap());
  assert.equal(rowSpan(S(), "w", "default", "t4", false).top, 2 * (row + rowGap()) + 0.5);
});

test("a tab dragged from the parent's reveals into a collapsed group inside it is not kept under the parent", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t3");
  S().activate("t0");
  assert.deepEqual(kept("g"), ["t:t3"]);
  S().placeTabs(["t3"], { pinned: false, groupId: "n" });
  assert.ok(S().groups.n.tabIds.includes("t3"));
  assert.equal(S().groups.g.shownTabIds, undefined);
  assert.deepEqual(kept("g"), []);
  assert.equal(shows("g"), false);
});

test("a tab moved into a collapsed group inside it stays under the parent while it is focused", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t3");
  S().placeTabs(["t3"], { pinned: false, groupId: "n" });
  assert.deepEqual(kept("g"), ["g:n"]);
  assert.deepEqual(kept("n"), ["t:t3"]);
  S().activate("t0");
  assert.deepEqual(kept("g"), []);
});

test("a closed window's snapshot of a collapsed group carries no reveal state", () => {
  hydrate();
  S().activate("t3");
  S().activate("t5");
  assert.deepEqual(S().groups.g.shownTabIds, ["t3", "t5"]);
  S().closeWindow("w");
  const closed = S().closedWindows.at(-1);
  assert.equal(closed.groups.length, 1);
  assert.equal("shownTabIds" in closed.groups[0], false);
});

test("telemetry counts each tab newly kept under a collapsed header once, however many groups list it", async () => {
  const { keptTabsAdded } = await import("../telemetry/usage.ts");
  hydrate({ nested: ["t3", "t4"] });
  const before = S().groups;
  S().activate("t3");
  S().activate("t5");
  assert.equal(keptTabsAdded(S().groups, before), 2);
  assert.equal(keptTabsAdded(S().groups, S().groups), 0);
});

test("expanding and collapsing the outer group starts the group inside it over too", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t4");
  S().activate("t5");
  S().activate("t0");
  assert.deepEqual(kept("n"), ["t:t4", "t:t5"]);
  S().updateGroup("g", { collapsed: false });
  S().updateGroup("g", { collapsed: true });
  assert.deepEqual(kept("n"), []);
  assert.deepEqual(kept(), []);
  S().updateGroup("g", { collapsed: false });
  S().activate("t5");
  S().updateGroup("g", { collapsed: true });
  S().activate("t0");
  assert.deepEqual(kept("n"), ["t:t5"]);
  assert.deepEqual(kept(), ["g:n"]);
});

test("a tab of a collapsed group reopened after closing stays under its header", () => {
  hydrate();
  S().activate("t3");
  S().closeTabs(["t3"]);
  S().reopenClosedTab("w");
  const reopened = S().windows.w.activeTabIds.default;
  assert.ok(S().groups.g.tabIds.includes(reopened));
  S().activate("t0");
  assert.ok(kept().includes(`t:${reopened}`));
});

test("an outer group expanded and collapsed by the Chrome-side sync starts the group inside it over too", () => {
  hydrate({ nested: ["t4", "t5"] });
  S().activate("t4");
  S().activate("t5");
  S().activate("t0");
  assert.deepEqual(kept("n"), ["t:t4", "t:t5"]);
  const set = (collapsed) => useBrowser.setState((s) => ({ groups: { ...s.groups, g: { ...s.groups.g, collapsed } } }));
  set(false);
  set(true);
  assert.deepEqual(kept("n"), []);
  assert.deepEqual(kept(), []);
});
