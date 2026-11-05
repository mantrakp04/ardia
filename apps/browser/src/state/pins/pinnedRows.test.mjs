import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const organize = await import("./tabGrouping.ts");
const { sidebarEntries, numberedTabs } = await import("../sidebar/entries.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const { Clock } = await import("@ardia/sync");
const S = () => useBrowser.getState();
const stamp = (wall) => new Clock("", null, () => wall).tick();
const reset = () => S().hydrate({});
const url = (id) => S().tabs[id].pinnedUrl || S().tabs[id].url;
const urls = (ids) => ids.map(url);
const entries = (w) => {
  const e = sidebarEntries(S(), w);
  return { tiles: urls(e.tiles), rows: urls(e.pinned.filter((x) => x.startsWith("t:")).map((x) => x.slice(2))) };
};
const kindChoices = (profileId = "default") => Object.keys(S().pinChoices[profileId] ?? {}).filter((k) => !k.includes(":"));
const tileOf = (w, u) => model.viewTabIds(S(), w).find((id) => !!S().tabs[id].pin && S().tabs[id].pinnedUrl === u);

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("pin as a row, move it to Top Apps and back, unpin: tiles stay tiles, rows sit after them", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  S().pinTabs([c], true);
  assert.deepEqual(entries(w), { tiles: ["https://a.com/", "https://c.com/"], rows: ["https://b.com/"] });
  assert.equal((S().tabs[b].pin?.as === "row"), true);
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/");
  assert.deepEqual(urls(S().windows[w].tabIds.slice(0, 3)), ["https://a.com/", "https://c.com/", "https://b.com/"], "tiles, then rows, in the window's order");
  assert.deepEqual(urls(numberedTabs(S(), w)), ["https://a.com/", "https://c.com/", "https://b.com/", "https://d.com/"], "⌘1–9: tiles, rows, then the list");

  S().placeTabs([a], { pinned: true, row: true, beforeId: b });
  assert.deepEqual(entries(w), { tiles: ["https://c.com/"], rows: ["https://a.com/", "https://b.com/"] });
  S().placeTabs([b], { pinned: true, row: false });
  assert.deepEqual(entries(w), { tiles: ["https://c.com/", "https://b.com/"], rows: ["https://a.com/"] });
  assert.equal((S().tabs[b].pin?.as === "row"), false);
  S().placeTabs([a], { pinned: true });
  assert.deepEqual(entries(w).rows, ["https://a.com/"], "a move inside the pinned area keeps a row a row");

  S().pinTabs([a], false);
  assert.equal(!!S().tabs[a].pin, false);
  assert.equal((S().tabs[a].pin?.as === "row"), false);
  S().pinTabs([a], true);
  assert.deepEqual(entries(w).tiles, ["https://c.com/", "https://b.com/", "https://a.com/"], "pinned again: a tile, as before");
});

test("moving a row up or down stays among the rows", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b, c], true, true);
  S().moveTab(b, 1);
  assert.deepEqual(entries(w), { tiles: ["https://a.com/"], rows: ["https://c.com/", "https://b.com/"] });
});

test("closing a row unloads it and keeps it; Close All Tabs keeps rows", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true, true);
  S().activate(a);
  S().closeTab(a);
  assert.ok(S().tabs[a], "still there");
  assert.equal(!!S().tabs[a].page.nav || !!S().tabs[a].page.adopt, false, "unloaded");
  assert.deepEqual(entries(w).rows, ["https://a.com/"]);
  S().activate(a);
  S().clearUnpinnedTabs(w);
  assert.deepEqual(entries(w).rows, ["https://a.com/"]);
  assert.equal(S().tabs[b], undefined);
  assert.equal(S().tabs[c], undefined);
});

test("a second middle click removes a closed row or pinned group tab, a tile or an open pin stays, and undo puts it back closed", () => {
  reset();
  const { w, ids: [a, b, c, d, e] } = windowWith("a", "b", "c", "d", "e");
  S().pinTabs([a], true);
  S().pinTabs([b, c], true, true);
  const g = S().groupTabs([d], { name: "P" });
  S().activate(e);
  assert.equal(S().removeClosedPin(b), null, "an open row only closes");
  S().closeTabs([a, b, c, d]);
  assert.equal(S().removeClosedPin(a), null, "a tile stays");
  assert.equal(S().removeClosedPin(e), null, "an unpinned tab isn't a pin");
  const closedBefore = S().closedTabs.length;
  const removed = S().removeClosedPin(b);
  assert.equal(removed.entries.length, 1);
  assert.equal(S().tabs[b], undefined);
  assert.deepEqual(entries(w).rows, ["https://c.com/"]);
  assert.equal(S().closedTabs.length, closedBefore + 1, "it goes to Recently Closed");
  S().undoClearTabs(removed);
  assert.deepEqual(entries(w).rows, ["https://b.com/", "https://c.com/"]);
  assert.equal(S().closedTabs.length, closedBefore);
  const back = model.viewTabIds(S(), w).find((id) => S().tabs[id].pinnedUrl === "https://b.com/");
  assert.equal(!!S().tabs[back].page.nav || !!S().tabs[back].page.adopt, false, "back closed, not loaded");
  assert.equal(model.activeTabId(S(), w), e);
  const lastPage = S().closedTabs.find((x) => x.tabId === back);
  assert.ok(lastPage, "the row's earlier close now points at the row that came back");
  S().restoreClosed(lastPage.id, w);
  assert.deepEqual(entries(w).rows, ["https://b.com/", "https://c.com/"], "reopening it loads the row, no second copy");
  assert.equal(model.activeTabId(S(), w), back);
  S().activate(e);
  const fromGroup = S().removeClosedPin(d);
  assert.ok(fromGroup);
  assert.equal(S().tabs[d], undefined);
  S().undoClearTabs(fromGroup);
  assert.deepEqual(S().groups[g].tabIds.map(url), ["https://d.com/"], "back in its pinned group");
});

test("undoing the removal of a pinned group's last tab brings the group back pinned, and so does ⇧⌘T", () => {
  reset();
  const { w, ids: [a, b] } = windowWith("a", "b");
  const g = S().groupTabs([a], { name: "P" });
  S().activate(b);
  S().closeTab(a);
  const removed = S().removeClosedPin(a);
  assert.ok(removed);
  assert.equal(S().groups[g], undefined, "the emptied group goes");
  S().undoClearTabs(removed);
  const back = Object.values(S().groups).find((x) => x.name === "P");
  assert.equal(back?.pinned, true);
  assert.equal(model.inPinnedContainer(S(), back.tabIds[0]), true);
  S().removeClosedPin(back.tabIds[0]);
  S().reopenClosedTab(w);
  assert.equal(Object.values(S().groups).find((x) => x.name === "P")?.pinned, true, "⇧⌘T");
});

test("remove, undo, then reopening the row's earlier close wakes it with its own back/forward list", () => {
  reset();
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().pinTabs([a], true, true);
  S().activate(b);
  S().closeTab(a);
  S().undoClearTabs(S().removeClosedPin(a));
  const back = model.viewTabIds(S(), w).find((id) => S().tabs[id].pinnedUrl === "https://a.com/");
  const lastPage = S().closedTabs.find((x) => x.tabId === back);
  S().restoreClosed(lastPage.id, w);
  assert.equal(S().tabs[back].page.adopt, `restore:${a}`);
});

test("undoing a pinned group tab's removal puts it back in its place in the group, in every window", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  const g = S().groupTabs([a, b], { name: "P" });
  const w2 = S().createWindow({ url: "https://x.com/" });
  S().activate(c);
  S().closeTab(a);
  S().undoClearTabs(S().removeClosedPin(a));
  const order = (win) => {
    const group = Object.values(S().groups).find((x) => x.name === "P" && x.windowId === win);
    return model.viewTabIds(S(), win).filter((id) => group.tabIds.includes(id)).map(url);
  };
  assert.deepEqual(S().groups[g].tabIds.map(url), ["https://a.com/", "https://b.com/"]);
  assert.deepEqual(order(w), ["https://a.com/", "https://b.com/"]);
  assert.deepEqual(order(w2), ["https://a.com/", "https://b.com/"]);
});

test("undoing a pin removal leaves alone a group sync brought back after it", () => {
  reset();
  const { w, ids: [a, b, x] } = windowWith("a", "b", "x");
  const p = S().groupTabs([a, b], { name: "P" });
  const c = S().groupTabs([a], { name: "C" });
  assert.equal(S().groups[c].parentId, p);
  S().activate(x);
  S().closeTab(a);
  const removed = S().removeClosedPin(a);
  assert.equal(S().groups[c], undefined, "the emptied nested group goes");
  const d = S().newTab(w, { url: "https://d.com/", background: true });
  const synced = { ...removed.groups.find((g) => g.id === c), tabIds: [d] };
  delete synced.parentId;
  useBrowser.setState((s) => ({ groups: { ...s.groups, [c]: synced } }));
  const before = JSON.stringify({ tabs: S().windows[w].tabIds, groups: S().groups });
  S().undoClearTabs(removed);
  assert.equal(JSON.stringify({ tabs: S().windows[w].tabIds, groups: S().groups }), before, "Undo does nothing");
});

test("undoing a pin removal does nothing once the pinned groups were reordered", () => {
  reset();
  const { w, ids: [a, b, c, x] } = windowWith("a", "b", "c", "x");
  S().groupTabs([a, b], { name: "P" });
  S().groupTabs([c], { name: "Q" });
  const w2 = S().createWindow({ url: "https://y.com/" });
  S().activate(x);
  S().closeTab(a);
  const removed = S().removeClosedPin(a);
  const p = organize.groupOf(S(), b).id;
  S().moveGroup(p, { pinned: true, beforeId: null });
  const order = (win) => model.viewTabIds(S(), win).map(url).filter((u) => u === "https://b.com/" || u === "https://c.com/");
  assert.deepEqual(order(w), ["https://c.com/", "https://b.com/"]);
  S().undoClearTabs(removed);
  assert.deepEqual(order(w), ["https://c.com/", "https://b.com/"]);
  assert.deepEqual(order(w2), ["https://c.com/", "https://b.com/"]);
  assert.equal(model.viewTabIds(S(), w).some((id) => url(id) === "https://a.com/"), false, "the removed pin stays removed");
});

test("rows are the profile's: a second window mirrors them, a change in one shows in the other", () => {
  reset();
  const { w: a, ids: [mail, docs] } = windowWith("mail", "docs", "x");
  S().pinTabs([mail], true);
  S().pinTabs([docs], true, true);
  const b = S().createWindow({ url: "https://b.com/" });
  assert.deepEqual(entries(b), { tiles: ["https://mail.com/"], rows: ["https://docs.com/"] });
  S().placeTabs([tileOf(b, "https://mail.com/")], { pinned: true, row: true });
  assert.deepEqual(entries(a), { tiles: [], rows: ["https://docs.com/", "https://mail.com/"] });
  S().placeTabs([tileOf(a, "https://docs.com/")], { pinned: true, row: false });
  assert.deepEqual(entries(b), { tiles: ["https://docs.com/"], rows: ["https://mail.com/"] });
});

test("rows park with the last window and come back as rows, and survive a relaunch", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w, ids: [a, b] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.deepEqual(entries(w), { tiles: ["https://a.com/"], rows: ["https://b.com/"] });
  assert.deepEqual(kindChoices().sort(), [a, b].sort(), "the choices not yet synced survive a relaunch");
  S().closeWindow(w);
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => [t.pinnedUrl, !!(t.pin?.as === "row")]), [["https://a.com/", false], ["https://b.com/", true]]);
  const n = S().createWindow();
  assert.deepEqual(entries(n), { tiles: ["https://a.com/"], rows: ["https://b.com/"] });
});

test("older data: 0.2.7's pinnedRow stays a tile, a stray row flag on an unpinned tab is dropped", () => {
  const tab = (id, u, pinned, extra = {}) => ({ id, windowId: "w", profileId: "default", url: u, title: "", favicon: null, pin: pinned ? { as: "tile" } : null, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: pinned ? u : null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra });
  S().hydrate({
    windows: { w: { id: "w", profileId: "default", kind: "main", tabIds: ["r", "t", "u"], activeTabIds: { default: "u" }, sidebarOpen: true, frame: null, createdAt: 0 } },
    windowOrder: ["w"],
    tabs: {
      r: tab("r", "https://r.com/", true, { pinnedRow: true }),
      t: tab("t", "https://t.com/", true),
      u: tab("u", "https://u.com/", false, { pinnedAsRow: true }),
    },
  });
  assert.deepEqual(entries("w"), { tiles: ["https://r.com/", "https://t.com/"], rows: [] });
  assert.equal((S().tabs.u.pin?.as === "row"), false);
  S().pinTabs(["u"], true);
  assert.deepEqual(entries("w").tiles, ["https://r.com/", "https://t.com/", "https://u.com/"]);
});

test("a closed row comes back as a row from its snapshot", () => {
  reset();
  const { ids: [a] } = windowWith("a", "b");
  S().pinTabs([a], true, true);
  assert.deepEqual(model.snapshotTab(S().tabs[a]).pin, { as: "row" });
  S().pinTabs([a], false);
  assert.notEqual(model.snapshotTab(S().tabs[a]).pin?.as, "row");
});

test("a pending tile or row choice moves with its pin to another profile, with a new generation", () => {
  reset();
  const work = S().createProfile({ name: "Work" });
  const { ids: [a] } = windowWith("a", "b");
  S().pinTabs([a], true);
  const before = S().pinChoices.default[a];
  assert.ok(before);
  S().moveTabToProfile(a, work);
  assert.equal(S().pinChoices.default?.[a], undefined, "gone from the source profile");
  assert.ok(S().pinChoices[work]?.[a] > before, "pending in the destination under the same pin key");
});

test("choices go with unpinned pins and deleted profiles, also after a relaunch, and parked pins keep theirs", () => {
  reset();
  const work = S().createProfile({ name: "Work" });
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a, b], true);
  S().pinTabs([b], false);
  assert.deepEqual(kindChoices(), [a], "unpinning drops its choice");
  assert.deepEqual(Object.keys(S().pinChoices.default).filter((k) => k.startsWith("place:")), [`place:${a}`], "and its placement choice");
  S().closeWindow(w);
  assert.deepEqual(kindChoices(), [a], "a parked pin keeps its choice");
  const ww = S().createWindow({ profileId: work, url: "https://w.com/" });
  const x = S().windows[ww].tabIds[0];
  S().pinTabs([x], true);
  S().deleteProfile(work);
  assert.equal(S().pinChoices[work], undefined, "a deleted profile's choices go");
  S().hydrate({ ...S(), pinChoices: { default: { [a]: stamp(5), ghost: stamp(6) }, gone: { y: stamp(7) } } });
  assert.deepEqual(S().pinChoices, { default: { [a]: stamp(5) } }, "stale choices from disk are dropped");
  const first = (S().pinTabs([c], true), S().pinChoices.default?.[c]);
  assert.equal(first, undefined, "c closed with its window");
});

test("a choice made again after its pin was unpinned never reuses a generation", () => {
  reset();
  const { ids: [a] } = windowWith("a", "b");
  S().pinTabs([a], true);
  const first = S().pinChoices.default[a];
  S().pinTabs([a], false);
  S().pinTabs([a], true);
  assert.ok(S().pinChoices.default[a] > first);
});

test("a session's pending choices raise the generation counter, so a later choice can't reuse one after a clock rollback", () => {
  reset();
  const { w, ids: [a] } = windowWith("a", "b");
  S().pinTabs([a], true);
  const ahead = stamp(Date.now() + 1e9);
  S().hydrate({ ...S(), pinChoices: { default: { [a]: ahead } } });
  assert.equal(S().pinChoices.default[a], ahead);
  S().pinTabs([a], false);
  S().pinTabs([a], true);
  assert.ok(S().pinChoices.default[a] > ahead, `${S().pinChoices.default[a]} after ${ahead}`);
  assert.ok(w);
});

test("moving a pin to another profile keeps the source's choice while another window there still has the pin", () => {
  reset();
  const work = S().createProfile({ name: "Work" });
  const w1 = S().createWindow({ url: "https://x.com/" });
  const [x] = S().windows[w1].tabIds;
  S().pinTabs([x], true);
  const w2 = S().createWindow({ url: "https://y.com/" });
  assert.ok(S().windows[w2].tabIds.some((id) => !!S().tabs[id].pin), "w2 mirrors the pin");
  const before = S().pinChoices.default[x];
  S().moveTabToProfile(x, work);
  assert.ok(S().windows[w2].tabIds.some((id) => !!S().tabs[id].pin && (S().tabs[id].pinKey ?? id) === x), "w2 keeps its pin");
  assert.ok(S().pinChoices.default?.[x] >= before, "and Personal keeps the pending choice for it");
  assert.ok(S().pinChoices[work]?.[x] > S().pinChoices.default[x], "Work gets its own, newer one");
});

test("empty and deleted profiles' choice entries are dropped", () => {
  reset();
  windowWith("a");
  S().hydrate({ ...S(), pinChoices: { default: {}, gone: {} } });
  assert.deepEqual(S().pinChoices, {});
});
