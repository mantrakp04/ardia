import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { closeIntent, closeKind } = await import("./tabs.ts");
const { activeTabId, viewTabIds } = await import("../browser/model.ts");
const { closeTab } = await import("../browser/actions.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("closing a Peek through either call ends the Peek and records nothing", () => {
  for (const close of [(id) => S().closeTab(id), (id) => S().closeTabs([id])]) {
    const { w, ids: [a] } = windowWith("a", "b");
    const peek = S().openPeek(a, "https://peek.example/", { x: 0, y: 0 });
    const closed = S().closedTabs.length;
    close(peek);
    assert.equal(S().peeks[w], undefined);
    assert.equal(S().tabs[peek], undefined);
    assert.ok(S().tabs[a]);
    assert.equal(S().closedTabs.length, closed);
  }
});

test("⌘W on the last tab closes the window; closing every tab at once keeps it with a New Tab", () => {
  const one = windowWith("a");
  S().closeTab(one.ids[0]);
  assert.equal(S().windows[one.w], undefined);

  const all = windowWith("a", "b");
  S().closeTabs(all.ids);
  assert.ok(S().windows[all.w]);
  const left = viewTabIds(S(), all.w);
  assert.equal(left.length, 1);
  assert.equal(S().tabs[left[0]].url, "");
});

test("closing a pinned tab with regular tabs unloads it and closes only those", () => {
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true, true);
  S().activate(a);
  S().closeTabs([a, b]);
  assert.ok(S().tabs[a], "the pinned row stays");
  assert.equal(!!S().tabs[a].page.nav || !!S().tabs[a].page.adopt, false, "unloaded");
  assert.equal(S().tabs[b], undefined);
  assert.ok(S().windows[w]);
  assert.equal(S().windows[w].activeTabIds[S().windows[w].profileId], c);
});

test("what ✕ does: close a tab, unload an open pin, remove a closed pinned row", () => {
  const { ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  S().activate(c);
  assert.deepEqual(closeIntent(S(), c), { kind: "close", ids: [c] });
  assert.equal(closeKind(S(), b), "unload");
  S().closeTabs([a, b]);
  assert.equal(closeKind(S(), b), "removePin");
  assert.deepEqual(closeIntent(S(), a), { kind: "unload", ids: [a] }, "a closed tile only unloads");
});

function lastTabBesidePinned(pin) {
  const { w, ids: [kept, last] } = windowWith("pinned", "last");
  pin(kept);
  S().activate(last);
  S().closeTabs([kept]);
  assert.equal(S().tabs[kept].page.kind, "asleep");
  return { w, kept, last };
}

const pinnings = {
  tile: (id) => S().pinTabs([id], true),
  "pinned row": (id) => S().pinTabs([id], true, true),
  "pinned group": (id) => S().groupTabs([id], { pinned: true }),
};

for (const [kind, pin] of Object.entries(pinnings)) {
  test(`closing the last tab beside an asleep ${kind} keeps the window, asks nothing and selects a New Tab, not the ${kind}`, async () => {
    const { w, kept, last } = lastTabBesidePinned(pin);
    await closeTab(last);
    assert.ok(S().windows[w], "the window stays");
    assert.equal(S().tabs[last], undefined, "the tab closed without a confirmation, which the test shell declines");
    const shown = activeTabId(S(), w);
    assert.notEqual(shown, kept);
    assert.equal(S().tabs[shown].url, "");
    assert.equal(S().tabs[kept].page.kind, "asleep", "the pinned item stays asleep");
    assert.deepEqual(viewTabIds(S(), w).sort(), [kept, shown].sort());
  });
}

test("⌘W on the empty window left beside pinned items closes the window as before", () => {
  const { w, last } = lastTabBesidePinned(pinnings.tile);
  S().closeTab(last);
  const empty = activeTabId(S(), w);
  S().closeTab(empty);
  assert.equal(S().windows[w], undefined);
});

test("an empty pinned group alone keeps the window on its last tab's close", () => {
  const { w, ids: [only] } = windowWith("only");
  const group = { id: "pinned-empty", windowId: w, profileId: S().windows[w].profileId, name: "Empty", icon: null, color: null, collapsed: false, pinned: true, tabIds: [], createdAt: 0 };
  useBrowser.setState({ groups: { ...S().groups, [group.id]: group } });
  S().closeTab(only);
  assert.ok(S().windows[w]);
  assert.equal(S().tabs[activeTabId(S(), w)].url, "");
});

test("without pinned items the last tab still asks before closing its window", async () => {
  const { w, ids: [only] } = windowWith("only");
  await closeTab(only);
  assert.ok(S().tabs[only], "the declined confirmation keeps the tab");
  S().closeTab(only);
  assert.equal(S().windows[w], undefined);
});

test("a pinned item in the profile the window doesn't show keeps nothing open", () => {
  const { w, ids: [only] } = windowWith("only");
  const other = S().createProfile({ name: "Other" });
  const elsewhere = S().newTab(w, { url: "https://elsewhere.com/", profileId: other, background: true });
  S().pinTabs([elsewhere], true);
  assert.equal(S().tabs[elsewhere].profileId, other);
  assert.notEqual(S().windows[w].profileId, other);
  S().closeTab(only);
  assert.equal(S().windows[w], undefined);
});

test("closing a window warns about the tabs it loses: none while another window shares them, all of them otherwise", async () => {
  const { closeWindowDialog, lostOnClose } = await import("../windows/windowClose.ts");
  S().hydrate({});
  const a = S().createWindow({ url: "https://a1.com" });
  S().newTab(a, { url: "https://a2.com" });
  const b = S().createWindow({ url: "https://b1.com" });
  S().newTab(b, { url: "https://b2.com" });
  S().updateSettings({ shareTabsAcrossWindows: false });
  assert.equal(lostOnClose(b).length, 2);
  assert.equal(closeWindowDialog(b).title, "Close 2 tabs?");
  S().updateSettings({ shareTabsAcrossWindows: true });
  assert.deepEqual(lostOnClose(b), [], "the other window keeps every tab");
  assert.equal(lostOnClose(a).length, 0);
  S().closeWindow(b);
  assert.equal(lostOnClose(a).length, 4, "the last window loses them all");
  assert.equal(closeWindowDialog(a).title, "Close 4 tabs?");
});

test("the last-tab sheet re-asked mid-close counts a replaced tab once and drops the forced ID that is gone", async () => {
  const { confirmLostTabs } = await import("../windows/windowClose.ts");
  const { nativeModule } = await import("@ardia/shell");
  const { w, ids: [x] } = windowWith("only");
  S().updateSettings({ warnBeforeClosingLastTab: true });
  const other = S().createProfile({ name: "Other" });
  const dialogs = nativeModule("ArdiaDialogs");
  const original = dialogs.confirm;
  const titles = [];
  dialogs.confirm = async ({ title }) => {
    titles.push(title);
    if (titles.length === 1) {
      S().newTab(w, { url: "https://elsewhere.com/", profileId: other, background: true });
      const holder = S().newTab(w, { url: "https://only.com/", background: true });
      const twin = S().newTab(w, { url: "https://only.com/", background: true });
      const { [x]: gone, ...tabs } = S().tabs;
      const pinKey = gone.pinKey ?? gone.id;
      tabs[holder] = { ...tabs[holder], pinKey };
      tabs[twin] = { ...tabs[twin], pinKey };
      const win = S().windows[w];
      useBrowser.setState({ tabs, windows: { ...S().windows, [w]: { ...win, tabIds: win.tabIds.filter((id) => id !== x), activeTabIds: { ...win.activeTabIds, [win.profileId]: holder } } } });
    }
    return { confirmed: true, suppressed: false };
  };
  try {
    const { lostOnClose } = await import("../windows/windowClose.ts");
    const { confirmed } = await confirmLostTabs(w, "warnBeforeClosingLastTab", () => [x, ...lostOnClose(w)]);
    assert.ok(confirmed);
    assert.deepEqual(titles, ["Close 1 tab?", "Close 2 tabs?"], "the holder and the twin are one tab, the stale forced ID none");
  } finally {
    dialogs.confirm = original;
  }
});

const askingDialogs = async () => {
  const { nativeModule } = await import("@ardia/shell");
  const dialogs = nativeModule("ArdiaDialogs");
  const original = dialogs.confirm;
  const titles = [];
  dialogs.confirm = async ({ title }) => (titles.push(title), { confirmed: false, suppressed: false });
  return { titles, restore: () => (dialogs.confirm = original) };
};

test("closing a window asks when it has several unpinned tabs and loses one, and closes quietly when nothing is lost or only one tab is", async () => {
  const { startWindowCloseGuard, lostOnClose } = await import("../windows/windowClose.ts");
  const stub = await import("../../test-native/index.ts");
  S().hydrate({});
  startWindowCloseGuard();
  S().updateSettings({ shareTabsAcrossWindows: false, warnBeforeClosingWindow: true });
  const request = async (id) => {
    stub.windows.emit({ type: "closeRequest", id });
    await new Promise((r) => setTimeout(r, 50));
  };
  const asked = await askingDialogs();
  try {
    const single = S().createWindow({ url: "https://single.com" });
    await request(single);
    assert.ok(!S().windows[single], "one unpinned tab: closes without a question, as before");
    const a = S().createWindow({ url: "https://a1.com" });
    S().newTab(a, { url: "https://a2.com" });
    const b = S().createWindow({ url: "https://b1.com" });
    S().newTab(b, { url: "https://b2.com" });
    S().updateSettings({ shareTabsAcrossWindows: true });
    assert.deepEqual(lostOnClose(b), []);
    await request(b);
    assert.ok(!S().windows[b], "several tabs, all kept by the other window: no question, the window closes");
    assert.deepEqual(asked.titles, []);
    const c = S().createWindow({ url: "https://c1.com" });
    S().openSplitPane(c, { anchorTabId: S().windows[c].tabIds[0], url: "https://c-only.com/" });
    const lost = lostOnClose(c);
    assert.ok(lost.length >= 1 && lost.length < S().windows[c].tabIds.length, `the split pane is lost, the shared tabs are not: ${lost.length} of ${S().windows[c].tabIds.length}`);
    await request(c);
    assert.ok(S().windows[c], "the declined question keeps the window");
    assert.deepEqual(asked.titles, [lost.length === 1 ? "Close 1 tab?" : `Close ${lost.length} tabs?`]);
  } finally {
    asked.restore();
  }
});

test("a last-tab sheet doesn't ask again for a tab that arrived while it was up, since the window then stays", async () => {
  const { nativeModule } = await import("@ardia/shell");
  const { w, ids: [x] } = windowWith("only");
  S().updateSettings({ warnBeforeClosingLastTab: true });
  const dialogs = nativeModule("ArdiaDialogs");
  const original = dialogs.confirm;
  const titles = [];
  dialogs.confirm = async ({ title }) => {
    titles.push(title);
    S().newTab(w, { url: "https://arrived.com/", background: true });
    return { confirmed: true, suppressed: false };
  };
  try {
    await closeTab(x);
    assert.deepEqual(titles, ["Close 1 tab?"]);
    assert.equal(S().tabs[x], undefined, "the asked-for tab closed");
    assert.ok(S().windows[w], "the window stays with the tab that arrived");
    assert.equal(S().windows[w].tabIds.length, 1);
  } finally {
    dialogs.confirm = original;
  }
});
