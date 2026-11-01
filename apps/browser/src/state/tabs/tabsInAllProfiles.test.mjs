import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSuggestions } from "@ardia/core";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { searchedTabs, searchesAllProfiles, withTabProfiles } = await import("./tabsInAllProfiles.ts");
const { searchCandidates, searchSections } = await import("../sidebar/searchTabs.ts");
const { useSuggestions } = await import("../../components/omnibox/useSuggestions.ts");
const { switchFromBar } = await import("../omnibox/openFromBar.ts");

const S = () => useBrowser.getState();

function setup() {
  S().hydrate({});
  const home = S().createWindow({ url: "https://home.example/inbox" });
  const homeProfile = S().windows[home].profileId;
  const [homeTab] = S().windows[home].tabIds;
  const work = S().createProfile({ name: "Work" });
  const elsewhere = S().createWindow({ url: "https://tracker.example/board", profileId: work });
  const [workTab] = S().windows[elsewhere].tabIds;
  const secret = S().createWindow({ kind: "private", url: "https://tracker.example/secret" });
  const [privateTab] = S().windows[secret].tabIds;
  return { home, homeProfile, homeTab, work, elsewhere, workTab, secret, privateTab };
}

const ids = (tabs) => tabs.map((t) => t.id);

test("off by default: the bar and Search Tabs keep to the window's profile", () => {
  const { home, homeProfile, homeTab } = setup();
  assert.equal(S().settings.searchTabsInAllProfiles, false);
  assert.equal(searchesAllProfiles(S().settings.searchTabsInAllProfiles, homeProfile), false);
  assert.deepEqual(ids(searchedTabs(S().tabs, homeProfile, false)), [homeTab]);
  const { open, elsewhere } = searchCandidates(home);
  assert.deepEqual(open.map((r) => r.id), [homeTab]);
  assert.deepEqual(elsewhere, []);
});

test("on: other profiles' tabs join the window's own, a private window's never", () => {
  const { home, homeProfile, homeTab, workTab, privateTab } = setup();
  S().updateSettings({ searchTabsInAllProfiles: true });
  const all = searchesAllProfiles(S().settings.searchTabsInAllProfiles, homeProfile);
  assert.equal(all, true);
  const found = ids(searchedTabs(S().tabs, homeProfile, all));
  assert.deepEqual(found, [homeTab, workTab]);
  assert.ok(!found.includes(privateTab));
  const { open, elsewhere } = searchCandidates(home);
  assert.deepEqual(open.map((r) => r.id), [homeTab]);
  assert.deepEqual(
    elsewhere.map((r) => [r.id, r.where, r.current]),
    [[workTab, "Work · Window 2", false]],
  );
});

test("on, from a private window: still only that window's own tabs", () => {
  const { secret, privateTab } = setup();
  S().updateSettings({ searchTabsInAllProfiles: true });
  const profileId = S().windows[secret].profileId;
  const all = searchesAllProfiles(S().settings.searchTabsInAllProfiles, profileId);
  assert.equal(all, false);
  assert.deepEqual(ids(searchedTabs(S().tabs, profileId, all)), [privateTab]);
  assert.deepEqual(searchCandidates(secret).elsewhere, []);
});

test("the suggestion engine finds the other profile's tab, labelled with its profile, and choosing it switches profile", () => {
  const { home, homeProfile, homeTab, work, workTab } = setup();
  S().updateSettings({ searchTabsInAllProfiles: true });
  const source = { tabs: searchedTabs(S().tabs, homeProfile, true), history: [], bookmarks: [] };
  const result = withTabProfiles(buildSuggestions("tracker", source, { currentTabId: homeTab }), S().tabs, homeProfile, S().profiles);
  const row = result.items.find((s) => s.kind === "page" && s.tabId === workTab);
  assert.ok(row, JSON.stringify(result.items));
  assert.equal(row.tabProfile, "Work");
  const own = withTabProfiles(buildSuggestions("home", source, {}), S().tabs, homeProfile, S().profiles);
  const ownRow = own.items.find((s) => s.kind === "page" && s.tabId === homeTab);
  assert.ok(ownRow);
  assert.equal(ownRow.tabProfile, undefined);

  switchFromBar(workTab, row.url, homeTab, "current");
  const owner = S().tabs[workTab].windowId;
  assert.equal(S().windows[owner].profileId, work);
  assert.equal(S().windows[owner].activeTabIds[work], workTab);
  assert.equal(S().windows[home].profileId, homeProfile);
});

test("a tab of another profile paged out in this same window is labelled with the profile alone", () => {
  const { home, homeProfile, homeTab, work } = setup();
  S().updateSettings({ searchTabsInAllProfiles: true });
  const paged = S().newTab(home, { url: "https://paged.example/", profileId: work });
  S().activate(homeTab);
  assert.equal(S().windows[home].profileId, homeProfile);
  const row = searchCandidates(home).elsewhere.find((r) => r.id === paged);
  assert.ok(row);
  assert.equal(row.where, "Work");
});

test("⌘↩ on another profile's tab opens its URL in a new tab of this profile and leaves the other profile alone", () => {
  const { home, homeProfile, homeTab, elsewhere, work, workTab } = setup();
  S().updateSettings({ searchTabsInAllProfiles: true });
  const before = new Set(Object.keys(S().tabs));
  switchFromBar(workTab, S().tabs[workTab].url, homeTab, "newTab");
  const added = Object.values(S().tabs).filter((t) => !before.has(t.id));
  assert.deepEqual(
    added.map((t) => [t.url, t.profileId, t.windowId]),
    [["https://tracker.example/board", homeProfile, home]],
  );
  assert.equal(S().windows[home].profileId, homeProfile);
  assert.equal(S().windows[elsewhere].profileId, work);
  assert.equal(S().windows[elsewhere].activeTabIds[work], workTab);
});

test("Search Tabs: a typed query finds the other profile's tab only with the setting on", () => {
  const { home, workTab, privateTab } = setup();
  const openRows = () => searchSections(home, "tracker").find((s) => s.title === "Open Tabs").rows.map((r) => r.id);
  assert.deepEqual(openRows(), []);
  S().updateSettings({ searchTabsInAllProfiles: true });
  assert.deepEqual(openRows(), [workTab]);
  assert.ok(!openRows().includes(privateTab));
  assert.deepEqual(searchSections(home, "").find((s) => s.title === "Open Tabs").rows.length, 1, "the list before typing stays this profile's");
});

test("the command bar hook: other profiles' tabs only with the setting on, and a site open in both switches within this profile", () => {
  const { home, homeProfile, homeTab, workTab } = setup();
  const h = mount(({ text }) => useSuggestions({ text, active: true, windowId: home, profileId: homeProfile, currentTabId: homeTab, scope: null }), { props: { text: "t" } });
  const rows = (text) => h.rerender({ text }).items.filter((x) => x.kind === "page").map((x) => ({ url: x.url, tabId: x.tabId ?? null, tabProfile: x.tabProfile ?? null }));
  assert.deepEqual(rows("tracker"), []);
  S().updateSettings({ searchTabsInAllProfiles: true });
  assert.deepEqual(rows("tracker"), [{ url: "https://tracker.example/board", tabId: workTab, tabProfile: "Work" }]);
  const ownCopy = S().newTab(home, { url: "https://tracker.example/board", background: true });
  assert.deepEqual(rows("tracker."), [{ url: "https://tracker.example/board", tabId: ownCopy, tabProfile: null }]);
  h.unmount();
});
