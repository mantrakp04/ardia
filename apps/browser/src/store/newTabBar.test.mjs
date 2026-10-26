import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { closeNewTabBar, openFromNewTabBar, toggleNewTabBar } = await import("../components/omnibox/newTabBar.ts");
const { togglePinnedRows, forgetListSpots } = await import("../components/sidebar/movePinned.ts");

const S = () => useBrowser.getState();
const reset = (newTabOpens = "page") => {
  S().hydrate({});
  S().updateSettings({ newTabOpens, newTabPosition: "bottom", cmdClickCreatesTabGroup: false });
  forgetListSpots();
};
const urlOf = (id) => S().tabs[id]?.url;
const list = (w) => S().windows[w].tabIds.filter((id) => !S().tabs[id].pinned).map(urlOf);
const rows = (w) => S().windows[w].tabIds.filter((id) => model.isPinnedRow(S().tabs[id])).map(urlOf);
const panel = (w) => S().windowUi[w]?.panel ?? { open: false };

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  S().activate(ids[0]);
  return { w, ids };
}

test("setting off: no bar, and the last tab still closes its window", () => {
  reset();
  const { w, ids: [a] } = windowWith("a", "b");
  assert.equal(toggleNewTabBar(w), false);
  assert.equal(toggleNewTabBar(w, { kind: "group", groupId: S().groupTabs([a], { pinned: false }) }), false);
  assert.equal(panel(w).open, false);
  const solo = S().createWindow({ url: "https://solo.com/" });
  S().closeTab(S().windows[solo].tabIds[0]);
  assert.equal(S().windows[solo], undefined, "the last tab closes its window");
});

test("setting on: the bar adds nothing; closing it again leaves everything as it was", () => {
  reset("commandBar");
  const { w, ids: [a] } = windowWith("a", "b");
  const before = { tabs: [...S().windows[w].tabIds], active: model.activeTabId(S(), w), closed: S().closedTabs.length };
  assert.equal(toggleNewTabBar(w), true);
  assert.deepEqual(panel(w), { open: true, initialText: "", newTab: { kind: "list" } });
  assert.deepEqual(S().windows[w].tabIds, before.tabs);
  toggleNewTabBar(w);
  assert.equal(panel(w).open, false, "⌘T again closes it");
  toggleNewTabBar(w);
  closeNewTabBar(w);
  assert.equal(panel(w).open, false, "Esc closes the bar");
  assert.deepEqual(S().windows[w].tabIds, before.tabs, "and nothing else");
  assert.equal(model.activeTabId(S(), w), a);
  assert.equal(S().closedTabs.length, before.closed);
});

test("a pick makes one selected unpinned tab at the top of the list, outside the selected tab's group", () => {
  reset("commandBar");
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().pinTabs([a], true);
  S().activate(b);
  S().groupTabs([b], { pinned: false });
  toggleNewTabBar(w);
  openFromNewTabBar(w, panel(w).newTab, "https://picked.com/");
  openFromNewTabBar(w, { kind: "list" }, "https://twice.com/");
  const picked = model.activeTabId(S(), w);
  assert.equal(urlOf(picked), "https://picked.com/");
  assert.deepEqual(list(w), ["https://picked.com/", "https://b.com/"], "one tab, at the top");
  assert.equal(S().tabs[picked].pinned, false);
  assert.equal(Object.values(S().groups).some((g) => g.tabIds.includes(picked)), false);
  assert.equal(panel(w).open, false);
});

test("⌥⌘T in a group: the pick goes into the group", () => {
  reset("commandBar");
  const { w, ids: [a] } = windowWith("a", "b");
  const group = S().groupTabs([a], { pinned: false });
  S().activate(a);
  toggleNewTabBar(w, { kind: "group", groupId: group });
  assert.deepEqual(panel(w).newTab, { kind: "group", groupId: group });
  assert.equal(S().groups[group].tabIds.length, 1);
  openFromNewTabBar(w, panel(w).newTab, "https://in-group.com/");
  assert.deepEqual(S().groups[group].tabIds.map(urlOf), ["https://a.com/", "https://in-group.com/"]);
  assert.equal(urlOf(model.activeTabId(S(), w)), "https://in-group.com/");
});

test("closing the last tab leaves an empty window whose pick fills it; ⌘W there closes the window", () => {
  reset("commandBar");
  const { w, ids: [a] } = windowWith("a");
  S().closeTab(a);
  assert.ok(S().windows[w], "the window stays");
  const empty = model.activeTabId(S(), w);
  assert.equal(urlOf(empty), "");
  assert.equal(S().windows[w].tabIds.length, 1);
  toggleNewTabBar(w);
  assert.deepEqual(panel(w).newTab, { kind: "into", tabId: empty });
  openFromNewTabBar(w, panel(w).newTab, "https://filled.com/");
  assert.deepEqual(S().windows[w].tabIds, [empty]);
  assert.equal(urlOf(empty), "https://filled.com/");
  S().closeTab(empty);
  const again = model.activeTabId(S(), w);
  S().closeTab(again);
  assert.equal(S().windows[w], undefined);
});

test("Move to Pinned: a tab goes to the pinned rows and back to where it was, in its group", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  const group = S().groupTabs([b, c], { pinned: false });
  S().activate(c);
  togglePinnedRows(w);
  assert.deepEqual(rows(w), ["https://c.com/"]);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://d.com/"]);
  togglePinnedRows(w);
  assert.deepEqual(rows(w), []);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"]);
  assert.deepEqual(S().groups[group].tabIds, [b, c]);

  S().activate(d);
  togglePinnedRows(w);
  togglePinnedRows(w);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"], "the last tab goes back last");
});

test("Move to Pinned on a selection, and on a tile", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().activate(a);
  S().setSelection(w, [a, c]);
  togglePinnedRows(w);
  assert.deepEqual(rows(w), ["https://a.com/", "https://c.com/"]);
  S().activate(a);
  S().setSelection(w, [a, c]);
  togglePinnedRows(w);
  assert.deepEqual(rows(w), []);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/"]);

  S().pinTabs([b], true);
  S().activate(b);
  S().setSelection(w, []);
  togglePinnedRows(w);
  assert.equal(S().tabs[b].pinned, false, "a tile is unpinned, not made a row");
  assert.deepEqual(rows(w), []);
});

test("Move to Pinned: neighbours pinned together come back in their order", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().activate(b);
  S().setSelection(w, [b, c]);
  togglePinnedRows(w);
  assert.deepEqual(rows(w), ["https://b.com/", "https://c.com/"]);
  S().activate(b);
  S().setSelection(w, [b, c]);
  togglePinnedRows(w);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"]);
  S().activate(c);
  S().setSelection(w, [c]);
  togglePinnedRows(w);
  S().activate(b);
  S().setSelection(w, [b]);
  togglePinnedRows(w);
  S().activate(c);
  S().setSelection(w, [c]);
  togglePinnedRows(w);
  S().activate(b);
  S().setSelection(w, [b]);
  togglePinnedRows(w);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"], "one at a time, either order");
});

test("Move out of Pinned from another window puts the first window's tab back where it was", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().activate(b);
  togglePinnedRows(w);
  const w2 = S().createWindow({ url: "https://other.com/" });
  const copy = S().windows[w2].tabIds.find((id) => S().tabs[id].pinnedAsRow);
  assert.ok(copy, "the row is mirrored into the second window");
  S().activate(copy);
  togglePinnedRows(w2);
  assert.equal(S().tabs[b].pinned, false);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.deepEqual(rows(w2), []);
});

test("a blank pinned tab is never the empty card a pick fills", () => {
  reset("commandBar");
  const { w, ids: [a] } = windowWith("a");
  const blank = S().newTab(w);
  S().pinTabs([blank], true);
  S().activate(blank);
  toggleNewTabBar(w);
  assert.deepEqual(panel(w).newTab, { kind: "list" });
  openFromNewTabBar(w, panel(w).newTab, "https://new.com/");
  assert.equal(S().tabs[blank].url, "");
  assert.equal(S().tabs[blank].pinned, true);
});

test("Move out of Pinned: two tabs pinned one after the other, unpinned together, keep their order", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  for (const id of [b, c]) {
    S().activate(id);
    S().setSelection(w, [id]);
    togglePinnedRows(w);
  }
  assert.deepEqual(rows(w), ["https://b.com/", "https://c.com/"]);
  S().activate(b);
  S().setSelection(w, [b, c]);
  togglePinnedRows(w);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"]);

  for (const id of [c, b]) {
    S().activate(id);
    S().setSelection(w, [id]);
    togglePinnedRows(w);
  }
  S().activate(c);
  S().setSelection(w, [b, c]);
  togglePinnedRows(w);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"], "pinned in the other order");
});

for (const [position, expected] of [
  ["top", ["picked", "a", "b", "c"]],
  ["bottom", ["a", "b", "c", "picked"]],
  ["nextToCurrent", ["a", "b", "picked", "c"]],
]) {
  test(`horizontal new-tab bar respects ${position} without changing pinned tabs`, () => {
    reset("commandBar");
    S().updateSettings({ tabLayout: "top" });
    const { w, ids: [pin, a, b, c] } = windowWith("pin", "a", "b", "c");
    S().pinTabs([pin], true);
    const pinnedBefore = { ...S().tabs[pin] };
    S().activate(b);
    S().updateSettings({ newTabPosition: position });
    assert.equal(model.tabLayoutOf(S(), w), "top");
    assert.equal(toggleNewTabBar(w), true);
    openFromNewTabBar(w, panel(w).newTab, "https://picked.com/");
    const picked = model.activeTabId(S(), w);
    assert.equal(urlOf(picked), "https://picked.com/");
    assert.equal(S().tabs[picked].pinned, false);
    assert.equal(panel(w).open, false);
    assert.deepEqual(S().tabs[pin], pinnedBefore);
    assert.deepEqual(S().windows[w].tabIds.filter((id) => S().tabs[id].pinned), [pin]);
    assert.deepEqual(list(w), expected.map((host) => `https://${host}.com/`));
    assert.deepEqual(S().windows[w].tabIds.filter((id) => [a, b, c].includes(id)), [a, b, c]);
  });
}

test("an incognito window's horizontal layout overrides the sidebar default for a bar pick", () => {
  reset("commandBar");
  S().updateSettings({ tabLayout: "sidebar" });
  const w = S().createWindow({ incognito: true, url: "https://a.com/" });
  const b = S().newTab(w, { url: "https://b.com/" });
  S().newTab(w, { url: "https://c.com/" });
  S().toggleTabLayout(w);
  S().updateSettings({ tabLayout: "sidebar", newTabPosition: "bottom" });
  S().activate(b);
  assert.equal(S().settings.tabLayout, "sidebar");
  assert.equal(model.tabLayoutOf(S(), w), "top");
  assert.equal(toggleNewTabBar(w), true);
  openFromNewTabBar(w, panel(w).newTab, "https://picked.com/");
  const picked = model.activeTabId(S(), w);
  assert.equal(urlOf(picked), "https://picked.com/");
  assert.equal(S().tabs[picked].profileId, S().windows[w].profileId);
  assert.equal(S().tabs[picked].pinned, false);
  assert.equal(panel(w).open, false);
  assert.deepEqual(list(w), ["https://a.com/", "https://b.com/", "https://c.com/", "https://picked.com/"]);
});
