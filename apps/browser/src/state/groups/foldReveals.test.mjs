import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { entryHeight } = await import("../sidebar/geometry.ts");
const { groupEntries, keptEntries, keptRows } = await import("../sidebar/entries.ts");
const { pressGroupHeader } = await import("../sidebar/actions.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

function setup() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://out.com/" });
  const out = S().windows[w].tabIds[0];
  const [a, b, c] = ["a", "b", "c"].map((h) => S().newTab(w, { url: `https://${h}.com/`, background: true }));
  const g = S().groupTabs([a, b, c], { pinned: false, name: "G" });
  const profileId = S().windows[w].profileId;
  const kept = () => keptEntries(S(), w, profileId, g, groupEntries(S(), g)).map((e) => e.slice(2));
  const pressHeader = () => pressGroupHeader(w, profileId, g);
  return { w, out, a, b, c, g, kept, pressHeader };
}

test("tabs opened while a group is collapsed stay under its header; collapsing shows only the focused one", () => {
  const { out, a, b, g, kept } = setup();
  S().activate(a);
  S().activate(b);
  S().updateGroup(g, { collapsed: true });
  assert.deepEqual(kept(), [b]);
  S().activate(out);
  assert.deepEqual(kept(), []);
  S().activate(a);
  S().activate(b);
  S().activate(out);
  assert.deepEqual(kept(), [a, b]);
});

test("a header click hides the revealed tabs but the focused one, the next click expands", () => {
  const { a, b, c, g, kept, pressHeader } = setup();
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  S().activate(b);
  S().activate(c);
  S().activate(a);
  assert.deepEqual(kept(), [a, b, c]);
  pressHeader();
  assert.equal(S().groups[g].collapsed, true);
  assert.deepEqual(kept(), [a]);
  pressHeader();
  assert.equal(S().groups[g].collapsed, false);
});

test("closing a revealed tab takes it off", () => {
  const { out, a, b, g, kept } = setup();
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  S().activate(b);
  S().activate(out);
  S().closeTabs([a]);
  assert.deepEqual(kept(), [b]);
});

test("expanding a group by any path, Chrome's included, forgets what it revealed", () => {
  const { out, a, b, g, kept } = setup();
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  S().activate(b);
  const setCollapsed = (collapsed) => useBrowser.setState((s) => ({ groups: { ...s.groups, [g]: { ...s.groups[g], collapsed } } }));
  setCollapsed(false);
  setCollapsed(true);
  assert.deepEqual(kept(), [b]);
  S().activate(out);
  assert.deepEqual(kept(), []);
});

test("closed tabs and deleted groups leave nothing behind", () => {
  const { out, a, b, g } = setup();
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  S().activate(b);
  S().activate(out);
  S().closeTabs([a]);
  assert.deepEqual(S().revealedInFold[g], [b]);
  S().deleteGroup(g);
  assert.equal(S().revealedInFold[g], undefined);
});

test("unloading a revealed tab of a pinned group forgets it, so unpinning the group doesn't bring it back", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://out.com/" });
  const out = S().windows[w].tabIds[0];
  const [a, b] = ["a", "b"].map((h) => S().newTab(w, { url: `https://${h}.com/`, background: true }));
  const g = S().groupTabs([a, b], { pinned: true, name: "P" });
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  S().activate(b);
  S().activate(out);
  S().closeTabs([a]);
  assert.ok(S().tabs[a]);
  assert.deepEqual(S().revealedInFold[g], [b]);
  S().updateGroup(g, { pinned: false });
  const profileId = S().windows[w].profileId;
  assert.deepEqual(keptEntries(S(), w, profileId, g, groupEntries(S(), g)).map((e) => e.slice(2)), [b]);
});

test("a collapsed parent lists the tabs kept in its nested groups as its own rows, and its header click hides them before it expands", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://out.com/" });
  const [a, b, c, d] = ["a", "b", "c", "d"].map((h) => S().newTab(w, { url: `https://${h}.com/`, background: true }));
  const root = S().groupTabs([a, b, c, d], { pinned: false, name: "R" });
  const inner = S().groupTabs([b, c], { name: "N" });
  S().updateGroup(inner, { collapsed: true });
  S().updateGroup(root, { collapsed: true });
  S().activate(b);
  S().activate(c);
  const profileId = S().windows[w].profileId;
  const rows = () => keptRows(S(), w, profileId, root).map((e) => e.slice(2));
  assert.deepEqual(rows(), [b, c]);
  assert.equal(entryHeight(S(), w, profileId, `g:${root}`), entryHeight(S(), w, profileId, `t:${a}`) * 3 + 3 + 2 + 1);
  pressGroupHeader(w, profileId, root);
  assert.equal(S().groups[root].collapsed, true);
  assert.deepEqual(rows(), [c]);
  pressGroupHeader(w, profileId, root);
  assert.equal(S().groups[root].collapsed, false);
  assert.deepEqual(keptEntries(S(), w, profileId, inner, [`t:${b}`, `t:${c}`]).map((e) => e.slice(2)), [c]);
});

test("a tab opened in the background into a collapsed group shows under its header", () => {
  const { a, g, kept } = setup();
  S().updateGroup(g, { collapsed: true });
  S().activate(a);
  const opened = S().newTab(S().tabs[a].windowId, { url: "https://n.com/", background: true, openerId: a });
  assert.ok(S().groups[g].tabIds.includes(opened));
  assert.deepEqual(kept(), S().groups[g].tabIds.filter((id) => id === a || id === opened));
});

test("a pinned group's copy in another window doesn't reveal the tabs Ardia mirrors into it", () => {
  S().hydrate({});
  const w1 = S().createWindow({ url: "https://out.com/" });
  const [a, b] = ["a", "b"].map((h) => S().newTab(w1, { url: `https://${h}.com/`, background: true }));
  const g1 = S().groupTabs([a, b], { pinned: true, name: "P" });
  const w2 = S().createWindow({ url: "https://two.com/" });
  const g2 = Object.values(S().groups).find((g) => g.windowId === w2).id;
  S().updateGroup(g2, { collapsed: true });
  const c = S().newTab(w1, { url: "https://c.com/", background: true });
  S().addTabsToGroup(g1, [c]);
  assert.equal(S().groups[g2].tabIds.length, 3);
  assert.equal(S().revealedInFold[g2], undefined);
});
