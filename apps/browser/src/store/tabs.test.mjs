import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const organize = await import("./organize.ts");
const { controllingSearchExtension, defaultSearchEngine, searchUrlPrefix } = await import("./settings.ts");
const media = await import("../components/media/state.ts");

const S = () => useBrowser.getState();
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
const short = (url) => url.replace(/^https:\/\/|\.com$/g, "");
const hosts = (w) => S().windows[w].tabIds.map((id) => short(S().tabs[id].url));
const shown = (w) => short(S().tabs[model.activeTabId(S(), w)].url);

const reset = (settings = {}) => {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom", ...settings });
};
const open = (w, url, opener, background = true) => S().newTab(w, { url: `${url}.com`, openerId: opener, background });
const setup = (...urls) => {
  const w = S().createWindow({ url: `${urls[0]}.com` });
  const ids = [S().windows[w].tabIds[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `${u}.com` }))];
  S().activate(ids[0]);
  return [w, ...ids];
};

test("links opened behind line up after their opener in order", () => {
  reset();
  const [w, a] = setup("a", "b");
  open(w, "c1", a);
  open(w, "c2", a);
  open(w, "c3", a);
  assert.deepEqual(hosts(w), ["a", "c1", "c2", "c3", "b"]);
  assert.equal(shown(w), "a", "opened behind: the opener stays in front");
});

test("closing a page opened in front returns to its opener unless you moved away", () => {
  reset();
  const [w, a, b] = setup("a", "b");
  const c = open(w, "c", a, false);
  S().closeTab(c);
  assert.equal(shown(w), "a");

  const d = open(w, "d", a, false);
  S().activate(b);
  S().activate(d);
  S().closeTab(d);
  assert.equal(shown(w), "b", "after moving away, the tab after it");
});

test("closing goes to the page's own tabs, then its siblings, then its opener", () => {
  reset();
  const [w, a] = setup("a", "b");
  const c1 = open(w, "c1", a);
  const c2 = open(w, "c2", a);
  S().activate(c1);
  const g = open(w, "g", c1);
  S().closeTab(c1);
  assert.equal(shown(w), "g", "a tab it opened");
  assert.equal(S().tabs[g].openerId, a, "a closed tab's tabs take its opener");
  S().activate(a);
  S().activate(c2);
  S().closeTab(c2);
  assert.equal(shown(w), "g", "a sibling");
  S().closeTab(g);
  assert.equal(shown(w), "a", "no siblings left: the opener");
});

test("closing a group that holds the shown tab shows the tab just above the group", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, pin, home] = setup("pin", "home");
  S().togglePin(pin);
  S().activate(home);
  S().activate(pin);
  const c1 = open(w, "c1", pin);
  open(w, "c2", pin);
  const group = Object.values(S().groups)[0];
  S().moveTab(home, 0);
  S().activate(c1);
  S().closeGroup(group.id);
  assert.equal(shown(w), "home", "not the pinned opener");
});

test("a pinned tab's links keep their group down to the last one; a loose tab's group of two ends with one", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, pin, home] = setup("pin", "home");
  S().togglePin(pin);
  S().activate(pin);
  const c1 = open(w, "c1", pin);
  const c2 = open(w, "c2", pin);
  const gathered = () => Object.values(S().groups).find((g) => g.pinnedOpenerId === pin);
  assert.deepEqual(gathered()?.tabIds, [c1, c2]);
  S().closeTab(c1);
  assert.deepEqual(gathered()?.tabIds, [c2], "the pinned tab's group started with one link and keeps its last");
  const c3 = open(w, "c3", pin);
  assert.deepEqual(gathered()?.tabIds, [c2, c3]);
  S().activate(home);
  const l1 = open(w, "l1", home);
  assert.ok(Object.values(S().groups).some((g) => g.tabIds.includes(home) && g.tabIds.includes(l1)));
  S().closeTab(l1);
  assert.ok(!Object.values(S().groups).some((g) => g.tabIds.includes(home)));
});

test("closing a pinned tab selects the regular tab the window showed last, not the neighbour", () => {
  reset();
  let clock = Date.now();
  const select = (id) => {
    const now = Date.now;
    Date.now = () => (clock += 1000);
    try {
      S().activate(id);
    } finally {
      Date.now = now;
    }
  };
  const [w, p, q, , b] = setup("p", "q", "a", "b", "c");
  S().togglePin(p);
  S().togglePin(q);
  select(b);
  select(q);
  select(p);
  S().closeTab(p);
  assert.equal(model.activeTabId(S(), w), b, "back to the regular tab used before the pinned ones");
  assert.ok(S().tabs[b].navigation);
  assert.notEqual(S().tabs[q].navigation, null, "the other pinned tab keeps its page");
});

test("groups stay contiguous; splits need two panes", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const b = S().newTab(w, { url: "b.com" });
  const c = S().newTab(w, { url: "c.com" });
  const a = model.viewTabIds(S(), w)[0];
  const g = S().createGroup([a, c], { name: "G" });
  assert.deepEqual(S().windows[w].tabIds, [a, c, b]);
  assert.deepEqual(S().groups[g].tabIds, [a, c]);
  S().addTabsToGroup(g, [b]);
  assert.deepEqual(S().groups[g].tabIds, [a, c, b]);
  S().closeTab(c);
  assert.deepEqual(S().groups[g].tabIds, [a, b]);
  const sp = S().createSplit([a, b]);
  S().closeTab(b);
  assert.equal(S().splits[sp], undefined);
  S().closeTab(a);
  assert.equal(S().closedWindows.at(-1).groups.length, 1);
});

test("hydrate drops broken splits", () => {
  reset();
  const w = S().createWindow({ url: "a.com" });
  const a = model.viewTabIds(S(), w)[0];
  const b = S().newTab(w, { url: "b.com" });
  S().hydrate({
    windows: S().windows,
    windowOrder: S().windowOrder,
    tabs: S().tabs,
    splits: {
      ok: { id: "ok", windowId: w, tabIds: [a, b], orientation: "horizontal", sizes: [0.5, 0.5] },
      stale: { id: "stale", windowId: w, tabIds: [a, "gone"], orientation: "horizontal", sizes: [0.5, 0.5] },
    },
  });
  assert.deepEqual(Object.keys(S().splits), ["ok"]);
});

test("clean up closes duplicates and stale tabs into Recently Cleaned, and restores", () => {
  reset();
  const [w, a, b, c, d] = setup("a", "b", "a", "d");
  const e = S().newTab(w, { url: "e.com" });
  S().pinTabs([d], true);
  const old = Date.now() - 13 * 3600_000;
  S().updateTab(b, { lastActiveAt: old });
  S().updateTab(d, { lastActiveAt: old });
  S().activate(a);
  assert.deepEqual(organize.cleanUpCandidates(S(), w), [b, c]);
  assert.equal(S().cleanUpTabs(w), 2);
  assert.deepEqual(view(w).sort(), ["https://a.com", "https://d.com", "https://e.com"]);
  assert.equal(S().cleanedTabs.length, 2);
  S().restoreCleaned();
  assert.equal(S().cleanedTabs.length, 0);
  assert.equal(view(w).length, 5);
  assert.ok(S().tabs[e]);
});

test("a reopened group's and cleaned tabs' tabs take their back/forward lists back", () => {
  reset();
  const [w, a, b, c, d] = setup("a", "b", "c", "d");
  const g = S().createGroup([b, c], { name: "G" });
  S().closeGroup(g);
  S().restoreClosed(S().closedGroups.at(-1).id);
  const adopts = (id) => S().tabs[id].adoptId ?? S().tabs[id].wakeAdoptId;
  const back = Object.values(S().groups).find((x) => x.name === "G");
  assert.deepEqual(back.tabIds.map(adopts), [`restore:${b}`, `restore:${c}`]);
  const g2 = S().createGroup([d], { name: "Old" });
  S().closeGroup(g2);
  const entry = S().closedGroups.at(-1);
  useBrowser.setState({ closedGroups: [...S().closedGroups.slice(0, -1), { ...entry, tabIds: undefined }] });
  S().restoreClosed(entry.id);
  const old = Object.values(S().groups).find((x) => x.name === "Old");
  assert.equal(adopts(old.tabIds[0]), undefined);
  assert.ok(S().tabs[old.tabIds[0]].url.includes("d.com"));
  S().updateTab(a, { lastActiveAt: Date.now() - 13 * 3600_000 });
  assert.equal(S().cleanUpTabs(w), 1);
  S().restoreCleaned();
  const restored = S().windows[w].tabIds.find((id) => adopts(id) === `restore:${a}`);
  assert.ok(restored, "the cleaned tab comes back with its list");
});

test("a reopened tab not shown yet keeps its back/forward list's source through another close", () => {
  reset();
  const [w, , b, c] = setup("a", "b", "c");
  const g = S().createGroup([b, c], { name: "G" });
  S().closeGroup(g);
  S().restoreClosed(S().closedGroups.at(-1).id);
  const [, c2] = Object.values(S().groups).find((x) => x.name === "G").tabIds;
  assert.equal(S().tabs[c2].wakeAdoptId, `restore:${c}`, "the second tab hasn't been shown");
  S().closeGroup(Object.values(S().groups).find((x) => x.name === "G").id);
  S().restoreClosed(S().closedGroups.at(-1).id);
  const [, c3] = Object.values(S().groups).find((x) => x.name === "G").tabIds;
  assert.equal(S().tabs[c3].wakeAdoptId, `restore:${c}`);
  S().closeTab(c3);
  S().reopenClosedTab();
  const c4 = S().windows[w].tabIds.find((id) => S().tabs[id].url.includes("c.com"));
  assert.equal(S().tabs[c4].adoptId ?? S().tabs[c4].wakeAdoptId, `restore:${c}`);
});

test("a pinned group's reopened tab, closed before it was shown, still wakes with its back/forward list", () => {
  reset();
  const [, , b, c] = setup("a", "b", "c");
  const g = S().groupTabs([b, c], { name: "P" });
  assert.equal(S().groups[g].pinned, true);
  S().closeGroup(g);
  S().restoreClosed(S().closedGroups.at(-1).id);
  const [, c2] = Object.values(S().groups).find((x) => x.name === "P").tabIds;
  assert.equal(S().tabs[c2].wakeAdoptId, `restore:${c}`);
  S().closeTab(c2);
  assert.ok(S().tabs[c2]?.unloaded, "it keeps its row");
  S().activate(c2);
  assert.equal(S().tabs[c2].adoptId, `restore:${c}`);
});

test("a pinned group's reopened tab not shown yet keeps its back/forward list through parking in the last window's close", () => {
  reset();
  const [w, , b, c] = setup("a", "b", "c");
  const g = S().groupTabs([b, c], { name: "P" });
  S().closeGroup(g);
  S().restoreClosed(S().closedGroups.at(-1).id);
  const [, c2] = Object.values(S().groups).find((x) => x.name === "P").tabIds;
  S().closeTab(c2);
  assert.equal(S().tabs[c2].wakeAdoptId, `restore:${c}`);
  S().closeWindow(w);
  assert.ok(S().parkedPins.default, "the profile's pins are parked");
  const n = S().createWindow();
  const back = S().windows[n].tabIds.find((id) => S().tabs[id].url.includes("c.com"));
  S().activate(back);
  assert.equal(S().tabs[back].adoptId, `restore:${c}`);
});

test("Settings shows the tab layout of the window in front, not a default it no longer follows", () => {
  reset({ tabLayout: "sidebar" });
  const [w] = setup("a");
  S().toggleTabLayout(w);
  S().toggleTabLayout(w);
  S().updateSettings({ tabLayout: "top" }, { fromSync: true });
  assert.equal(S().windows[w].tabLayout, "sidebar", "the window keeps its own layout");
  assert.equal(model.tabLayoutOf(S()), "sidebar", "so Settings shows that one");
  S().toggleTabLayout(w);
  assert.equal(model.tabLayoutOf(S()), "top");
});

test("⇧⌘T reopens only what the window's shown profile closed", () => {
  reset();
  const [w, , b] = setup("a", "b");
  S().closeTab(b);
  const p = S().createProfile({ name: "Work" });
  S().switchProfile(w, p);
  const work = S().newTab(w, { url: "w.com" });
  S().reopenClosed(w);
  assert.equal(S().windows[w].profileId, p, "it stays on Work");
  assert.ok(!Object.values(S().tabs).some((t) => short(t.url) === "b"), "the default profile's tab stays closed");
  S().closeTab(work);
  S().reopenClosed(w);
  assert.ok(Object.values(S().tabs).some((t) => short(t.url) === "w" && t.profileId === p), "Work's own tab comes back");
  S().switchProfile(w, "default");
  S().reopenClosedTab(w);
  assert.ok(Object.values(S().tabs).some((t) => short(t.url) === "b" && t.profileId === "default"));
});

test("abandoned New Tab cleanup never closes a window or the tab it shows", () => {
  reset();
  const w = S().createWindow();
  S().newTab(w, { background: true });
  const front = S().newTab(w);
  S().closeAbandonedNewTabs();
  assert.deepEqual(S().windows[w].tabIds, [front]);
  const p = S().createProfile({ name: "Work" });
  S().switchProfile(w, p);
  const work = model.activeTabId(S(), w);
  S().switchProfile(w, "default");
  S().closeAbandonedNewTabs();
  assert.ok(S().tabs[work] && S().tabs[front]);
  const w2 = S().createWindow();
  S().newTab(w2);
  useBrowser.setState((s) => ({ windows: { ...s.windows, [w2]: { ...s.windows[w2], activeTabIds: {} } } }));
  S().closeAbandonedNewTabs();
  assert.equal(S().windows[w2].tabIds.length, 1);
});

test("an extension that took the default search engine controls it until it goes", () => {
  reset();
  const ddg = {
    profile: "",
    extensionId: "dcielhccnenaljfdmekhnepaeenphgjp",
    extensionName: "Search Fixture Default",
    name: "DuckDuckGo Fixture",
    keyword: "ddgfix",
    url: "https://duckduckgo.com/?q=%s&t=nnfixture",
    isDefault: true,
  };
  const wiki = { ...ddg, extensionId: "lfkochledepkdapbginilfnephdpkfjc", extensionName: "Search Fixture Extra", name: "Wikipedia Fixture", keyword: "wfix", url: "https://en.wikipedia.org/w/index.php?search=%s", isDefault: false };
  S().updateSettings({ searchEngine: "bing", extensionSearchEngines: [ddg, wiki] });
  assert.equal(controllingSearchExtension(S().settings)?.extensionId, ddg.extensionId);
  assert.equal(defaultSearchEngine(S().settings).id, `extension:${ddg.extensionId}`);
  assert.equal(searchUrlPrefix(S().settings), ddg.url);

  S().updateSettings({ extensionSearchEngines: [wiki] });
  assert.equal(controllingSearchExtension(S().settings), undefined);
  assert.equal(defaultSearchEngine(S().settings).id, "bing");

  S().setSearchEngine(`extension:${wiki.extensionId}`);
  assert.equal(defaultSearchEngine(S().settings).name, "Wikipedia Fixture");
  S().updateSettings({ extensionSearchEngines: [] });
  assert.equal(defaultSearchEngine(S().settings).id, "google", "a removed engine falls back to Google");
});

test("closing the mini player lasts until its tab plays again", async () => {
  const M = () => media.useMedia.getState();
  const report = (overrides = {}) => ({
    title: "Song", artist: "Band", album: "", artwork: null, playbackState: "playing", position: 10, duration: 200,
    playbackRate: 1, timestamp: Date.now(), hasVideo: false, actions: ["play", "pause"], controllable: true, ...overrides,
  });
  reset();
  const w = S().createWindow({ url: "a.com" });
  const [a] = model.viewTabIds(S(), w);
  const b = S().newTab(w, { url: "b.com", background: true });
  const c = S().newTab(w, { url: "c.com", background: true });

  media.setNowPlaying(b, report());
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  assert.equal(media.playerTabFor(M(), [a, b, c]), b, "the tab that played");
  media.setNowPlaying(b, report({ playbackState: "paused" }));
  await new Promise((resolve) => setTimeout(resolve, 3));
  media.setNowPlaying(c, report());
  assert.equal(media.playerTabFor(M(), [a, b, c]), c, "the tab that played last");

  media.useMedia.setState({ dismissed: { [c]: true } });
  assert.equal(media.playerTabFor(M(), [a, b, c]), b);
  media.setNowPlaying(c, report({ position: 30 }));
  assert.equal(M().dismissed[c], true, "still playing: stays dismissed");
  media.setNowPlaying(c, report({ playbackState: "paused" }));
  media.setNowPlaying(c, report());
  assert.equal(M().dismissed[c], undefined, "played again");
  assert.equal(media.playerTabFor(M(), [a, b, c]), c);

  S().closeTab(b);
  assert.equal(M().sessions[b], undefined);
});

test("Clear closes the unselected unpinned tabs into Recently Closed, keeps pinned tabs and pinned groups, and undoes", () => {
  reset();
  const [w, a, b, c, d, e, f] = setup("a", "b", "c", "d", "e", "f");
  S().pinTabs([a], true);
  const pinnedGroup = S().groupTabs([b], { name: "P" });
  const g = S().createGroup([d, e], { name: "G" });
  S().updateGroup(g, { color: "blue" });
  S().activate(e);
  const before = hosts(w);
  assert.deepEqual(organize.unpinnedTabIds(S(), w), [c, d, e, f]);
  const cleared = S().clearUnpinnedTabs(w);
  assert.equal(cleared.entries.length, 3);
  assert.deepEqual(hosts(w), ["a", "b", "e"]);
  assert.equal(shown(w), "e", "the selected tab stays selected");
  assert.ok(S().groups[pinnedGroup], "the pinned group stays");
  assert.deepEqual(S().groups[g].tabIds, [e], "the selected tab keeps its group");
  assert.deepEqual(S().closedTabs.slice(-3).map((x) => short(x.tab.url)), ["c", "d", "f"]);
  S().undoClearTabs(cleared);
  assert.deepEqual(hosts(w), before);
  assert.equal(shown(w), "e");
  const back = Object.values(S().groups).filter((x) => x.name === "G");
  assert.equal(back.length, 1, "undo refills the group, no second one");
  assert.deepEqual(back[0].tabIds.map((id) => short(S().tabs[id].url)), ["d", "e"]);
  assert.equal(back[0].color, "blue");
  assert.equal(S().closedTabs.length, 0, "undone tabs leave Recently Closed");
  assert.equal(S().clearUnpinnedTabs(w).entries.length, 3);
  S().reopenClosedTab(w);
  assert.deepEqual(hosts(w), ["a", "b", "e", "f"], "⇧⌘T brings the last one back");
});

test("Clear keeps the selected tab's split and tabs playing media, and does nothing with only those left", () => {
  reset();
  const [w, a, b, , d] = setup("a", "b", "c", "d", "e");
  S().createSplit([a, b]);
  S().activate(a);
  S().updateLive(d, { playingAudio: true });
  const before = hosts(w);
  const cleared = S().clearUnpinnedTabs(w);
  assert.deepEqual(cleared.entries.map((x) => short(x.tab.url)), ["c", "e"]);
  assert.deepEqual(hosts(w), ["a", "b", "d"]);
  assert.equal(shown(w), "a");
  assert.ok(Object.values(S().splits).some((v) => v.tabIds.includes(a) && v.tabIds.includes(b)), "the split stays whole");
  assert.equal(S().clearUnpinnedTabs(w), null, "nothing left to clear");
  S().undoClearTabs(cleared);
  assert.deepEqual(hosts(w), before);
  assert.equal(shown(w), "a");
});

test("Clear and undo bring an automatic group back whole, with the member Clear kept", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, a] = setup("a", "c");
  const b = open(w, "b", a);
  assert.equal(Object.values(S().groups)[0].autoUngroup, true);
  S().activate(b);
  const cleared = S().clearUnpinnedTabs(w);
  assert.deepEqual(hosts(w), ["b"]);
  assert.equal(Object.keys(S().groups).length, 0, "with one member left the automatic group dissolves");
  S().undoClearTabs(cleared);
  assert.deepEqual(hosts(w), ["a", "b", "c"]);
  const groups = Object.values(S().groups);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tabIds.map((id) => short(S().tabs[id].url)), ["a", "b"]);
  assert.equal(groups[0].autoUngroup, true);
});

test("Clear and undo keep a nested group inside the automatic group it was in", () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, a] = setup("a", "c");
  const b = open(w, "b", a);
  const parent = Object.values(S().groups)[0].id;
  const child = S().groupTabs([b], { pinned: false, name: "C" });
  assert.equal(S().groups[child].parentId, parent);
  S().activate(b);
  const cleared = S().clearUnpinnedTabs(w);
  assert.equal(S().groups[parent], undefined, "the automatic group dissolves");
  S().undoClearTabs(cleared);
  assert.deepEqual(hosts(w), ["a", "b", "c"]);
  const auto = Object.values(S().groups).find((g) => g.autoUngroup);
  const nested = Object.values(S().groups).find((g) => g.name === "C");
  assert.equal(nested.parentId, auto.id);
  assert.deepEqual(auto.tabIds.map((id) => short(S().tabs[id].url)), ["a", "b"]);
  assert.deepEqual(nested.tabIds.map((id) => short(S().tabs[id].url)), ["b"]);
});

test("Undo of Clear keeps a rename or collapse made after Clear", () => {
  reset();
  const [w, , , d, e] = setup("a", "b", "d", "e");
  const g = S().createGroup([d, e], { name: "G" });
  S().activate(e);
  const cleared = S().clearUnpinnedTabs(w);
  S().updateGroup(g, { name: "Renamed", color: "red", collapsed: true });
  S().undoClearTabs(cleared);
  assert.deepEqual(hosts(w), ["a", "b", "d", "e"]);
  assert.deepEqual(S().groups[g].tabIds.map((id) => short(S().tabs[id].url)), ["d", "e"]);
  assert.equal(S().groups[g].name, "Renamed");
  assert.equal(S().groups[g].color, "red");
  assert.equal(S().groups[g].collapsed, true);
});

const nestedInAutomatic = () => {
  reset({ cmdClickCreatesTabGroup: true });
  const [w, a] = setup("a", "c");
  const b = open(w, "b", a);
  const child = S().groupTabs([b], { pinned: false, name: "C" });
  S().activate(b);
  return { w, b, child, cleared: S().clearUnpinnedTabs(w) };
};

const frozen = (w) => JSON.stringify({ tabs: S().windows[w].tabIds, groups: S().groups, closed: S().closedTabs.map((c) => c.id) });

for (const [name, edit] of [
  ["moves the surviving group into another group", ({ w, child }) => S().moveGroup(child, { pinned: false, parentId: S().groupTabs([open(w, "d")], { pinned: false, name: "Q" }) })],
  ["ungroups the surviving group", ({ child }) => S().ungroup(child)],
  ["pins the surviving group", ({ child }) => S().moveGroup(child, { pinned: true })],
  ["pins the surviving tab", ({ b }) => S().pinTabs([b], true)],
  ["reopens the cleared tab with ⇧⌘T", ({ w }) => S().reopenClosedTab(w)],
]) {
  test(`Undo of Clear does nothing once the user ${name}`, () => {
    const ctx = nestedInAutomatic();
    edit(ctx);
    const before = frozen(ctx.w);
    S().undoClearTabs(ctx.cleared);
    assert.equal(frozen(ctx.w), before);
    assert.equal(organize.canUndoClear(S(), ctx.cleared), false);
  });
}

test("Undo of Clear still works after changes in another window", () => {
  const ctx = nestedInAutomatic();
  const other = S().createWindow({ url: "z.com" });
  S().newTab(other, { url: "y.com" });
  assert.equal(organize.canUndoClear(S(), ctx.cleared), true);
  S().undoClearTabs(ctx.cleared);
  assert.deepEqual(hosts(ctx.w), ["a", "b", "c"]);
});

test("Clear on a lone selected tab closes nothing and opens no New Tab page", () => {
  reset({ newTabPosition: "top" });
  const [w, a] = setup("a");
  assert.equal(S().clearUnpinnedTabs(w), null);
  assert.deepEqual(S().windows[w].tabIds, [a]);
});
