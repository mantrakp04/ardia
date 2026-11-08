import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const entries = await import("./entries.ts");
const { entriesHeight, entryHeight } = await import("./geometry.ts");
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
  assert.equal(height(), bare + 2 * height("t:t0") + rowGap());
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
  S().activate("t5");
  S().updateGroup("g", { collapsed: false });
  S().updateGroup("g", { collapsed: true });
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
