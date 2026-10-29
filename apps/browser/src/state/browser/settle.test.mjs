import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser, storeTransaction } = await import("./store.ts");
const { settle, SettleDidNotConverge, SETTLE_STEPS } = await import("./settle.ts");
const model = await import("./model.ts");
const folders = await import("../pins/tileFolders.ts");
const { hasPage } = await import("../tabs/pageSession.ts");
const { isRegularWindow } = await import("../windows/small.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".com", "");
const groupPath = (s, id) => {
  const names = [];
  for (let g = Object.values(s.groups).find((x) => x.tabIds.includes(id) && !Object.values(s.groups).some((c) => c.parentId === x.id && c.tabIds.includes(id))); g; g = s.groups[g.parentId ?? ""])
    names.unshift(g.name);
  return names.join("/");
};
const pinnedArea = (s, w, profileId) =>
  model.viewTabIds(s, w, profileId).filter((id) => model.inPinnedContainer(s, id)).map((id) => {
    const t = s.tabs[id];
    const place = !!t.pin ? ((t.pin?.as === "row") ? "row" : t.pin?.folder ? `tile[${t.pin?.folder.id}]` : "tile") : groupPath(s, id);
    return `${place}:${model.pinKeyOf(t)}:${t.customTitle ?? ""}:${t.pinnedUrl}`;
  });
const area = (w) => model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
  const t = S().tabs[id];
  return `${!!t.pin ? ((t.pin?.as === "row") ? "row" : t.pin?.folder ? "tile[]" : "tile") : groupPath(S(), id)}:${host(id)}`;
});
const tileOf = (w, h) => model.viewTabIds(S(), w).find((id) => model.inPinnedContainer(S(), id) && host(id) === h);

function settledProblems(s) {
  const problems = [];
  const windows = Object.values(s.windows).filter(isRegularWindow);
  const profiles = new Set(windows.flatMap((w) => model.viewTabIds(s, w.id).map((id) => s.tabs[id].profileId).concat(w.profileId)));
  for (const p of profiles) {
    const shown = windows.filter((w) => w.tabIds.some((id) => s.tabs[id]?.profileId === p));
    const areas = new Set(shown.map((w) => pinnedArea(s, w.id, p).join(" | ")));
    if (areas.size > 1) problems.push(`profile ${p}'s pinned areas differ: ${[...areas].join(" ≠ ")}`);
  }
  for (const t of Object.values(s.tabs)) {
    if (!s.windows[t.windowId]?.tabIds.includes(t.id) && s.peeks[t.windowId]?.tabId !== t.id) problems.push(`${t.id} isn't in its window`);
    if (t.page.holderId) {
      const h = s.tabs[t.page.holderId];
      if (!h || !hasPage(h) || h.page.holderId || h.profileId !== t.profileId || model.pinKeyOf(h) !== model.pinKeyOf(t)) problems.push(`${t.id} is frozen on a holder that can't hold it`);
    }
    if (t.pin?.folder && (!t.pin || (t.pin?.as === "row"))) problems.push(`${t.id} has a folder but isn't a tile`);
    if (!!t.pin && t.liveItem) problems.push(`${t.id} is pinned and still a live item`);
  }
  for (const g of Object.values(s.groups)) {
    const w = s.windows[g.windowId];
    if (!w || !g.tabIds.every((id) => w.tabIds.includes(id) && s.tabs[id]?.windowId === g.windowId)) problems.push(`group ${g.name} holds tabs outside its window`);
    const parent = g.parentId ? s.groups[g.parentId] : undefined;
    if (parent && !g.tabIds.every((id) => parent.tabIds.includes(id))) problems.push(`group ${g.name} isn't inside ${parent.name}`);
  }
  for (const [w, peek] of Object.entries(s.peeks)) if (model.activeTabId(s, w) !== peek.sourceId) problems.push(`window ${w}'s peek outlived its source`);
  return problems;
}

function watchSettled() {
  const seen = [];
  const off = useBrowser.subscribe((s) => {
    const problems = settledProblems(s);
    if (problems.length) seen.push(problems);
  });
  return () => {
    off();
    return seen;
  };
}

function win(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

function pinnedPair() {
  S().hydrate({});
  const { w: a, ids } = win("m", "d", "x");
  S().pinTabs(ids.slice(0, 2), true);
  const { w: b } = win("b");
  return { a, b, x: ids[2] };
}

test("pinning in one window: listeners hear it once, already mirrored to the other", () => {
  const { a, b, x } = pinnedPair();
  const heard = [];
  const off = useBrowser.subscribe(() => heard.push(area(b).join(" ")));
  S().pinTabs([x], true);
  off();
  assert.deepEqual(heard, ["tile:m tile:d tile:x"]);
  assert.deepEqual(area(a), area(b));
});

test("two windows changing their pins in one batch: the focused window wins", () => {
  const { a, b } = pinnedPair();
  const y = S().newTab(a, { url: "https://y.com/", background: true });
  const z = S().newTab(b, { url: "https://z.com/", background: true });
  assert.equal(model.focusedWindowOf?.(S()) ?? S().ui.focusOrder[0], b);
  storeTransaction(() => {
    S().pinTabs([y], true);
    S().pinTabs([z], true);
  });
  assert.deepEqual(area(b), ["tile:m", "tile:d", "tile:z"]);
  assert.deepEqual(area(a), area(b), "A's pin of y gives way to B's state");
  assert.equal(!!S().tabs[y].pin, false);
  storeTransaction(() => {
    S().updateTab(tileOf(a, "m"), { customTitle: "FromA" });
    S().updateTab(tileOf(b, "m"), { customTitle: "FromB" });
  });
  assert.equal(S().tabs[tileOf(a, "m")].customTitle, "FromB");
  assert.equal(S().tabs[tileOf(b, "m")].customTitle, "FromB");
});

test("a folder dissolving before mirroring: unpinning in the other window dissolves it in both", () => {
  const { a, b } = pinnedPair();
  useBrowser.setState(folders.addToTileFolder(S(), [tileOf(a, "d")], tileOf(a, "m")), true);
  assert.deepEqual(area(b), ["tile[]:m", "tile[]:d"]);
  const done = watchSettled();
  S().pinTabs([tileOf(b, "d")], false);
  assert.deepEqual(done(), []);
  assert.deepEqual(area(b), ["tile:m"]);
  assert.deepEqual(area(a), ["tile:m"]);
});

test("a peek closing before mirroring: switching tab and pinning in one batch closes the peek and mirrors the pin", () => {
  const { a, b } = pinnedPair();
  const m = tileOf(a, "m");
  S().activate(m);
  const peek = S().openPeek(m, "https://peek.com/");
  const q = S().newTab(a, { url: "https://q.com/", background: true });
  const heard = [];
  const off = useBrowser.subscribe((s) => heard.push(`${!!s.peeks[a]}:${area(b).join(" ")}`));
  storeTransaction(() => {
    S().activate(q);
    S().pinTabs([q], true);
  });
  off();
  assert.deepEqual(heard, ["false:tile:m tile:d tile:q"]);
  assert.equal(S().tabs[peek], undefined);
  assert.deepEqual(area(a), area(b));
});

test("nesting before mirroring: a group nested in the other window is nested in the first, heard once", () => {
  const { a, b } = pinnedPair();
  const [o1, o2] = [S().newTab(b, { url: "https://o1.com/", background: true }), S().newTab(b, { url: "https://o2.com/", background: true })];
  S().groupTabs([o1, o2], { pinned: true, name: "Outer" });
  const heard = [];
  const off = useBrowser.subscribe(() => heard.push(area(a).join(" ")));
  S().groupTabs([o2], { name: "Inner" });
  off();
  assert.deepEqual(heard, ["tile:m tile:d Outer:o1 Outer/Inner:o2"]);
  assert.deepEqual(area(b), area(a));
});

test("pin, share, split, peek and close: every state a listener hears is settled", () => {
  const { a, b, x } = pinnedPair();
  const done = watchSettled();
  S().updateSettings({ shareTabsAcrossWindows: true });
  const r1 = S().newTab(a, { url: "https://r1.com/", background: true });
  S().pinTabs([r1], true, true);
  const live = S().newTab(b, { url: "https://live.com/" });
  S().updateTab(live, { liveItem: { folderId: "f", itemId: "i" } });
  S().pinTabs([live], true);
  S().activate(tileOf(b, "m"));
  S().createSplit([x, S().newTab(a, { url: "https://s.com/", background: true })]);
  storeTransaction(() => {
    S().activate(tileOf(a, "d"));
    S().openPeek(tileOf(a, "d"), "https://peek.com/");
    S().pinTabs([tileOf(b, "m")], false);
    S().updateSettings({ shareTabsAcrossWindows: false });
  });
  const c = S().createWindow({ url: "https://c.com/" });
  S().closeWindow(a);
  S().closeWindow(c);
  assert.deepEqual(done(), []);
  assert.equal(S().tabs[live]?.liveItem, undefined, "a tab pinned out of a live folder leaves it");
});

test("a step that never settles is named once the round limit is reached", () => {
  S().hydrate({});
  let n = 0;
  const steps = [...SETTLE_STEPS, ["restless", (s) => ({ ...s, selection: { n: [String(++n)] } })]];
  assert.throws(() => settle(S(), S(), steps), (e) => e instanceof SettleDidNotConverge && e.steps.join() === "restless" && e.settled.selection.n[0] === String(n));
});

test("inside a transaction listeners wait, writes read unsettled; at the end they hear the settled state once", () => {
  const { a, b, x } = pinnedPair();
  const heard = [];
  const off = useBrowser.subscribe((s, prev) => heard.push([area(b).join(" "), !!prev.tabs[x].pin]));
  storeTransaction(() => {
    S().pinTabs([x], true);
    assert.deepEqual(area(b), ["tile:m", "tile:d"], "B isn't mirrored yet");
    assert.deepEqual(heard, []);
  });
  off();
  assert.deepEqual(heard, [["tile:m tile:d tile:x", false]]);
  assert.deepEqual(area(a), area(b));
});

test("a subscriber's own write is settled and heard by the others", () => {
  const { a, b, x } = pinnedPair();
  const off = useBrowser.subscribe((s) => {
    if (s.tabs[x]?.customTitle === "go" && !s.tabs[x].pin) S().pinTabs([x], true);
  });
  const heard = [];
  const off2 = useBrowser.subscribe(() => heard.push(area(b).join(" ")));
  S().updateTab(x, { customTitle: "go" });
  off();
  off2();
  assert.ok(heard.includes("tile:m tile:d tile:x"));
  assert.deepEqual(area(a), area(b));
});
