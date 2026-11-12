import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { splitTabIdsOf } = await import("../splits/splits.ts");
const { pinKeyOf } = model;

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const loaded = (id) => !!S().tabs[id]?.page.nav || !!S().tabs[id]?.page.adopt;
const shown = (w) => model.activeTabId(S(), w);
const list = (w) => model.viewTabIds(S(), w).filter((id) => !S().tabs[id].pin && S().tabs[id].url);
const urls = (w) => list(w).map((id) => S().tabs[id].url);
const keys = (w) => list(w).map((id) => pinKeyOf(S().tabs[id]));
const rowOf = (w, url) => list(w).find((id) => S().tabs[id].url === url);
const pages = (url) => Object.values(S().tabs).filter((t) => t.url === url && (t.page.nav || t.page.adopt) && !t.page.holderId);
const share = (on) => S().updateSettings({ shareTabsAcrossWindows: on });

function twoWindows() {
  const a = S().createWindow({ url: "https://a1.com" });
  const [a1] = S().windows[a].tabIds;
  const a2 = S().newTab(a, { url: "https://a2.com" });
  S().activate(a1);
  const b = S().createWindow({ url: "https://b1.com" });
  const [b1] = S().windows[b].tabIds;
  return { a, b, a1, a2, b1 };
}

test("off by default: each window keeps its own unpinned tabs, as before", () => {
  reset();
  assert.equal(S().settings.shareTabsAcrossWindows, false);
  const { a, b } = twoWindows();
  assert.deepEqual(urls(a), ["https://a1.com", "https://a2.com"]);
  assert.deepEqual(urls(b), ["https://b1.com"]);
  assert.equal(Object.values(S().tabs).some((t) => t.page.holderId || t.pinKey), false);
});

test("turning it on gives every window of the profile the same list; each keeps its selection", () => {
  reset();
  const { a, b, a1, b1 } = twoWindows();
  share(true);
  assert.deepEqual(urls(a), ["https://a1.com", "https://a2.com", "https://b1.com"]);
  assert.deepEqual(keys(b), keys(a), "same tabs, same order");
  assert.equal(shown(a), a1);
  assert.equal(shown(b), b1);
  assert.equal(pages("https://a1.com").length, 1, "a copy loads nothing");
  assert.equal(pages("https://b1.com").length, 1);
});

test("a tab opened in one window shows up in the other, and closing it in either closes it in both", () => {
  reset();
  const { a, b } = twoWindows();
  share(true);
  const t = S().newTab(a, { url: "https://new.com", background: true });
  assert.ok(rowOf(b, "https://new.com"), "B lists it");
  assert.equal(loaded(rowOf(b, "https://new.com")), false, "without loading it");
  S().closeTab(rowOf(b, "https://new.com"));
  assert.equal(S().tabs[t], undefined, "gone from A too");
  assert.equal(rowOf(a, "https://new.com"), undefined);
});

test("selecting a tab that is live in another window moves its page here; that window shows it frozen", () => {
  reset();
  const { a, b, a1 } = twoWindows();
  share(true);
  const copy = rowOf(b, "https://a1.com");
  S().activate(copy);
  assert.equal(S().tabs[a1].windowId, b, "the live tab (same id, same page) is now in B");
  assert.equal(shown(b), a1);
  assert.equal(S().tabs[shown(a)].page.holderId, a1, "A keeps that row selected, showing the page frozen");
  assert.equal(pages("https://a1.com").length, 1, "one live page");
  assert.deepEqual(keys(a), keys(b), "the lists didn't change");
  S().activate(shown(a));
  assert.equal(S().tabs[a1].windowId, a, "clicking it in A pulls it back");
});

test("rows of a tab live elsewhere follow its title and address", () => {
  reset();
  const { a, b, a1 } = twoWindows();
  share(true);
  S().updateTab(a1, { url: "https://a1.com/page", title: "Page" }, {});
  const copy = S().tabs[list(b)[0]];
  assert.equal(copy.page.holderId, a1);
  assert.equal(copy.url, "https://a1.com/page");
  assert.equal(copy.title, "Page");
});

test("closing one window keeps its tabs in the other and doesn't record them as a closed window", () => {
  reset();
  const { a, b, b1 } = twoWindows();
  share(true);
  S().closeWindow(b);
  assert.deepEqual(urls(a), ["https://a1.com", "https://a2.com", "https://b1.com"]);
  assert.equal(S().tabs[rowOf(a, "https://b1.com")].id, b1, "B's live page came back to A");
  assert.equal(S().closedWindows.length, 0);
});

test("Move to Window brings the page there and leaves the row where it was", () => {
  reset();
  const { a, b, a2 } = twoWindows();
  share(true);
  S().moveTabsToWindow([a2], b);
  assert.equal(S().tabs[a2].windowId, b);
  assert.equal(shown(b), a2);
  assert.deepEqual(keys(a), keys(b));
  assert.equal(list(b).filter((id) => pinKeyOf(S().tabs[id]) === pinKeyOf(S().tabs[a2])).length, 1, "no second row in B");
});

test("a tab group is shared too", () => {
  reset();
  const { a, b, a1, a2 } = twoWindows();
  share(true);
  S().groupTabs([a1, a2], { pinned: false });
  const groupsIn = (w) => Object.values(S().groups).filter((g) => g.windowId === w && !g.pinned);
  assert.equal(groupsIn(b).length, 1);
  assert.deepEqual(groupsIn(b)[0].tabIds.map((id) => pinKeyOf(S().tabs[id])), [a1, a2]);
});

test("clean up treats a tab as used when any window used it", () => {
  reset();
  const { a, b, a2 } = twoWindows();
  share(true);
  const copy = rowOf(b, "https://a2.com");
  const day = 24 * 3_600_000;
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [copy]: { ...s.tabs[copy], lastActiveAt: Date.now() - 2 * day } } }));
  S().cleanUpTabs(b, { inactiveForMs: day });
  assert.ok(S().tabs[a2], "A just used it, so B's clean up keeps it");
});

test("turning it off leaves each tab in one window: the live one, nothing duplicated", () => {
  reset();
  const { a, b, a1, b1 } = twoWindows();
  share(true);
  S().activate(rowOf(b, "https://a1.com"));
  share(false);
  const all = [...list(a), ...list(b)];
  assert.equal(all.length, 3, "three tabs, once each");
  assert.equal(S().tabs[a1].windowId, b, "a1's page stays where it is live");
  assert.ok(list(b).includes(b1));
  assert.equal(Object.values(S().tabs).some((t) => t.page.holderId || t.pinKey), false);
  assert.ok(S().windows[a], "no window closed");
  S().newTab(a, { url: "https://after.com" });
  assert.equal(rowOf(b, "https://after.com"), undefined, "and windows are separate again");
});

test("pinning a shared tab from a window showing it frozen keeps its live page", () => {
  reset();
  const { a, b, a1 } = twoWindows();
  share(true);
  const copy = rowOf(b, "https://a1.com");
  assert.equal(S().tabs[copy].page.holderId, a1);
  S().pinTabs([copy], true);
  assert.ok(S().tabs[a1], "the live tab is still there");
  assert.equal(loaded(a1), true, "with its page");
  assert.equal(!!S().tabs[a1].pin, true, "now as A's copy of the pin");
  assert.equal(S().tabs[a1].windowId, a);
  assert.equal(shown(a), a1, "A keeps showing it");
  assert.equal(pages("https://a1.com").length, 1, "one live page");
});

test("making a split from a shared tab live in another window brings its page into the split", () => {
  reset();
  const { a, b, a1, b1 } = twoWindows();
  share(true);
  const copy = rowOf(b, "https://a1.com");
  S().createSplit([b1, copy]);
  assert.ok(S().tabs[a1], "the live tab is still there");
  assert.equal(loaded(a1), true, "with its page");
  assert.equal(S().tabs[a1].windowId, b, "in B");
  assert.ok(Object.values(S().splits).some((v) => v.windowId === b && splitTabIdsOf(v).includes(a1) && splitTabIdsOf(v).includes(b1)), "as a pane of the split");
  assert.equal(S().tabs[copy], undefined, "in place of the frozen copy");
  assert.equal(rowOf(a, "https://a1.com"), undefined, "A's list follows B's");
  assert.equal(pages("https://a1.com").length, 1);
});

test("the ⌘T bar's open tabs rank a shared tab by its last use in any window, listing it once", async () => {
  reset();
  const { recentTabSuggestions } = await import("@ardia/core");
  const { openTabsByUse } = await import("./tabShare.ts");
  const { b, a1, a2 } = twoWindows();
  share(true);
  const x = rowOf(b, "https://a1.com");
  const y = rowOf(b, "https://a2.com");
  const at = { [x]: 1000, [y]: 2000, [a2]: 2000, [a1]: 3000 };
  useBrowser.setState((s) => ({ tabs: Object.fromEntries(Object.entries(s.tabs).map(([id, t]) => [id, at[id] ? { ...t, lastActiveAt: at[id] } : t])) }));
  const rows = openTabsByUse(S().tabs, S().peeks, { profileId: "default", windowId: b, shared: true }).map(({ tab, lastActiveAt }) => ({ id: tab.id, url: tab.url, title: "", favicon: null, lastActiveAt }));
  const order = recentTabSuggestions(rows).map((r) => r.tabId);
  assert.ok(order.includes(x) && order.indexOf(x) < order.indexOf(y), "A used X last, so X ranks above Y");
  assert.equal(order.includes(a1), false, "listed once, as B's own row");
});

for (const how of ["openSplitPane", "replaceSplitPane"]) {
  test(`${how} with a shared tab live in another window brings its page into the split`, () => {
    reset();
    const { a, b, a1, b1 } = twoWindows();
    share(true);
    const copy = rowOf(b, "https://a1.com");
    assert.equal(S().tabs[copy].page.holderId, a1);
    const seq = S().tabs[a1].page.nav.seq;
    if (how === "openSplitPane") S().openSplitPane(b, { anchorTabId: b1, tabId: copy });
    else {
      const b2 = S().newTab(b, { url: "https://b2.com", background: true });
      S().createSplit([b1, b2]);
      S().replaceSplitPane(b2, copy);
    }
    assert.ok(S().tabs[a1], "the live tab is still there");
    assert.equal(S().tabs[a1].windowId, b, "in B");
    assert.ok(Object.values(S().splits).some((v) => v.windowId === b && splitTabIdsOf(v).includes(a1) && splitTabIdsOf(v).includes(b1)), "as a pane of the split");
    assert.equal(shown(b), a1, "shown there");
    assert.equal(S().tabs[copy], undefined, "in place of the frozen copy");
    assert.equal(rowOf(a, "https://a1.com"), undefined, "A's list follows B's");
    assert.equal(pages("https://a1.com").length, 1, "no second page loaded");
    assert.equal(S().tabs[a1].page.nav.seq, seq, "the page itself, not a reload");
  });
}

for (const where of ["pinned split", "split in a pinned group"]) {
  for (const how of ["openSplitPane", "replaceSplitPane"]) {
    test(`${how} into a ${where} with a shared tab live in another window brings its page into the split`, () => {
      reset();
      const { b, a1, b1 } = twoWindows();
      share(true);
      const b2 = S().newTab(b, { url: "https://b2.com", background: true });
      const b3 = S().newTab(b, { url: "https://b3.com", background: true });
      const splitId = S().createSplit([b2, b3]);
      if (where === "pinned split") S().pinTabs([b2], true);
      else S().placeTabs([b2], { pinned: false, groupId: S().groupTabs([b1], { pinned: true, name: "P" }) });
      assert.equal(model.inPinnedContainer(S(), b2), true);
      const copy = rowOf(b, "https://a1.com");
      assert.equal(S().tabs[copy].page.holderId, a1);
      const seq = S().tabs[a1].page.nav.seq;
      if (how === "openSplitPane") S().openSplitPane(b, { anchorTabId: b2, tabId: copy });
      else S().replaceSplitPane(b3, copy);
      assert.ok(S().tabs[a1], "the live tab is still there");
      assert.equal(S().tabs[a1].windowId, b, "in B");
      assert.ok(splitTabIdsOf(S().splits[splitId]).includes(a1), "as a pane of the split");
      assert.equal(model.inPinnedContainer(S(), a1), true, "pinned with the split");
      assert.equal(S().tabs[copy], undefined, "in place of the frozen copy");
      assert.equal(pages("https://a1.com").length, 1, "no second page loaded");
      assert.equal(S().tabs[a1].page.nav.seq, seq, "the page itself, not a reload");
    });
  }
}

for (const where of ["pinned split", "split in a pinned group"]) {
  test(`handing a page to a ${where} from a New Tab pane leaves the other window a tab to show`, () => {
    reset();
    const a = S().createWindow({ url: "https://x.com" });
    const [x] = S().windows[a].tabIds;
    const b = S().createWindow({ url: "https://b1.com" });
    const [b1] = S().windows[b].tabIds;
    share(true);
    const y = S().newTab(b, { url: "https://y.com", background: true });
    const z = S().newTab(b, { background: true });
    S().navigate(z, "https://z.com");
    S().updateTab(z, { url: "https://z.com/", title: "Z" }, {});
    const splitId = S().createSplit([y, z]);
    if (where === "pinned split") S().pinTabs([y], true);
    else S().placeTabs([y], { pinned: false, groupId: S().groupTabs([b1], { pinned: true, name: "P" }) });
    S().updateTab(z, { url: "", title: "New Tab" }, {});
    const copy = rowOf(b, "https://x.com");
    assert.equal(S().tabs[copy].page.holderId, x);
    S().replaceSplitPane(z, copy);
    assert.equal(S().tabs[x].windowId, b, "the page went to B's split");
    assert.ok(splitTabIdsOf(S().splits[splitId]).includes(x));
    const showing = shown(a);
    assert.ok(showing && S().tabs[showing]?.windowId === a, "A still shows one of its own tabs");
    assert.equal(S().windows[a].tabIds.includes(showing), true);
  });
}

function personalAndWork() {
  const work = S().createProfile({ name: "Work" });
  const a = S().createWindow({ url: "https://x.com" });
  const [x] = S().windows[a].tabIds;
  const w1 = S().newTab(a, { url: "https://work.com", profileId: work, background: true });
  S().activate(x);
  const b = S().createWindow({});
  share(true);
  return { work, a, b, x, w1 };
}

const showsOwnTab = (w, profileId) => {
  const id = shown(w);
  return !!id && S().tabs[id]?.windowId === w && S().tabs[id].profileId === profileId;
};

test("closing a window's last tab of the profile it shows elsewhere leaves it a New Tab of that profile", () => {
  reset();
  const { work, a, b, x, w1 } = personalAndWork();
  S().closeTab(rowOf(b, "https://x.com"));
  assert.equal(S().tabs[x], undefined);
  assert.equal(S().windows[a].profileId, "default");
  assert.ok(showsOwnTab(a, "default"), "A shows a Personal tab");
  assert.equal(S().tabs[shown(a)].url, "", "a New Tab");
  assert.equal(S().windows[a].activeTabIds[work], w1, "Work keeps its own selection");
});

test("turning sharing off leaves a window that only had a copy of the profile it shows a New Tab of it", () => {
  reset();
  const { work, a, b, x, w1 } = personalAndWork();
  S().activate(rowOf(b, "https://x.com"));
  assert.equal(S().tabs[x].windowId, b);
  share(false);
  assert.ok(showsOwnTab(a, "default"), "A shows a Personal tab");
  assert.equal(S().windows[a].activeTabIds[work], w1);
  assert.equal(pages("https://x.com").length, 1);
});
