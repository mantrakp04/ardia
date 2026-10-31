import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { closedGroupMenuItems, openClosedGroupMenu, openClosedGroupsOverflowMenu } = await import("./closedGroupMenus.ts");
const { activeTabId } = await import("../browser/model.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");
const S = () => useBrowser.getState();

function setup() {
  S().hydrate({});
  const windowId = S().createWindow();
  const tabs = ["https://example.com/", "https://example.org/"].map((url) => S().newTab(windowId, { url }));
  const group = S().createGroup(tabs, { name: "Research" });
  S().closeGroup(group);
  return { windowId, entry: S().closedGroups[0] };
}

async function pick(open, select, meanwhile = () => {}) {
  const shell = shellNativeModules.ArdiaMenus;
  const real = shell.showMenu;
  shell.showMenu = async (items) => { meanwhile(); return select(items); };
  try { await open(); } finally { shell.showMenu = real; }
}

const action = (items, title) => items.find((item) => item.title === title).id;

test("visible and overflowed groups share all actions and saved tab rows", async () => {
  const { windowId, entry } = setup();
  const items = closedGroupMenuItems(entry);
  assert.deepEqual(items.slice(0, 4).map((item) => item.title), ["Open Group", "Open Group in New Window", "Unpin Group from Bookmarks Bar", "Delete Group"]);
  assert.deepEqual(items[4], { separator: true });
  assert.equal(items[5].title, "Tabs in Group");
  assert.equal(items[5].enabled, false);
  assert.equal(items[6].title, "example.com");
  assert.equal(items[6].symbol, "globe");
  await pick(() => openClosedGroupsOverflowMenu(windowId, [entry.id]), (menu) => {
    assert.deepEqual(menu[0].children.map((item) => item.title), items.map((item) => item.title));
    return action(menu[0].children, "Delete Group");
  });
  assert.equal(S().closedGroups.length, 0);
  assert.equal(S().deletedGroups[0].id, entry.id);
});

test("overflow can reopen, unpin or open a saved tab without deleting the group", async () => {
  for (const title of ["Open Group", "Unpin Group from Bookmarks Bar", "example.com"]) {
    const { windowId, entry } = setup();
    await pick(() => openClosedGroupsOverflowMenu(windowId, [entry.id]), (menu) => action(menu[0].children, title));
    if (title === "Open Group") assert.equal(S().closedGroups.length, 0);
    else assert.equal(S().closedGroups[0].hiddenFromBar === true, title === "Unpin Group from Bookmarks Bar");
    if (title === "example.com") assert.equal(S().tabs[activeTabId(S(), windowId)].url, entry.tabs[0].url);
    assert.equal(S().deletedGroups.length, 0);
  }
});

test("a menu cannot act after its group disappears or the window changes profile", async () => {
  for (const change of ["group", "profile"]) {
    const { windowId, entry } = setup();
    await pick(() => openClosedGroupMenu(windowId, entry.id), (items) => action(items, "Open Group in New Window"), () => {
      if (change === "group") S().restoreClosed(entry.id, windowId);
      else S().switchProfile(windowId, S().createProfile({ name: "Other" }));
    });
    assert.equal(Object.keys(S().windows).length, 1);
  }
});

test("opening a group from its menu creates one same-profile window with its saved tabs", async () => {
  const { windowId, entry } = setup();
  const before = [...S().windowOrder];
  await pick(() => openClosedGroupMenu(windowId, entry.id), (items) => action(items, "Open Group in New Window"));
  assert.equal(S().windowOrder.length, before.length + 1);
  const made = S().windows[S().windowOrder.find((id) => !before.includes(id))];
  assert.equal(made.profileId, S().windows[windowId].profileId);
  assert.deepEqual(made.tabIds.map((id) => S().tabs[id].url), entry.tabs.map((tab) => tab.url));
  const group = Object.values(S().groups).find((group) => group.windowId === made.id);
  assert.equal(group.name, "Research");
  assert.deepEqual(group.tabIds, made.tabIds);
  assert.equal(S().closedGroups.length, 0);
});
