import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { closedGroupsForProfile, closedGroupsOnBarForProfile, reopenClosedGroup, deleteClosedGroup, unpinClosedGroup, reopenClosedGroupInNewWindow, openClosedGroupTab } = await import("./closedGroups.ts");
const { startPersistence, flushPersistence, loadSession } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");
const S = () => useBrowser.getState();

function setup() {
  S().hydrate({});
  const windowId = S().createWindow({ url: "https://keep.example/" });
  return windowId;
}

function close(windowId, name = "Research") {
  const ids = ["one", "two"].map((host) => S().newTab(windowId, { url: `https://${host}.example/` }));
  const groupId = S().createGroup(ids, { name });
  S().closeGroup(groupId);
  return { entry: S().closedGroups.at(-1), ids, groupId };
}

test("closed groups retain more than twenty snapshots without live tabs or individual closed entries", () => {
  const windowId = setup();
  for (let i = 0; i < 25; i++) {
    const { ids, groupId } = close(windowId, `Group ${i}`);
    assert.ok(ids.every((id) => !S().tabs[id]));
    assert.equal(S().groups[groupId], undefined);
  }
  assert.equal(S().closedGroups.length, 25);
  assert.equal(S().closedTabs.length, 0);
});

test("a closed group opens in the requested same-profile window and only once", () => {
  const original = setup();
  const { entry } = close(original);
  const target = S().createWindow();
  reopenClosedGroup(entry.id, target);
  const group = Object.values(S().groups).find((group) => group.name === "Research");
  assert.equal(group.windowId, target);
  assert.equal(S().closedGroups.length, 0);
  const count = Object.keys(S().tabs).length;
  reopenClosedGroup(entry.id, target);
  assert.equal(Object.keys(S().tabs).length, count);
});

test("closed groups cannot cross profiles or open in private windows", () => {
  const windowId = setup();
  const { entry } = close(windowId);
  const profileId = S().createProfile({ name: "Other" });
  const other = S().createWindow({ profileId });
  assert.deepEqual(closedGroupsForProfile(S(), profileId), []);
  reopenClosedGroup(entry.id, other);
  assert.equal(S().closedGroups.length, 1);
  const privateWindow = S().createWindow({ kind: "private" });
  reopenClosedGroup(entry.id, privateWindow);
  assert.equal(S().closedGroups.length, 1);
  close(privateWindow);
  assert.equal(S().closedGroups.length, 1);
});

test("deleting a closed group preserves separate seven-day recovery and rejects another profile", () => {
  const windowId = setup();
  const { entry } = close(windowId);
  deleteClosedGroup(entry.id, "missing");
  assert.equal(S().closedGroups.length, 1);
  deleteClosedGroup(entry.id, "default");
  assert.equal(S().closedGroups.length, 0);
  assert.equal(S().deletedGroups.at(-1).id, entry.id);
  S().restoreClosed(entry.id, windowId);
  assert.equal(S().deletedGroups.length, 0);
  assert.ok(Object.values(S().groups).some((group) => group.name === "Research"));
});

test("closed groups survive saving and relaunching without restoring their live tabs", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const windowId = setup();
  const { entry, ids } = close(windowId);
  flushPersistence();
  stop();
  assert.ok(stub.docs.has("session.json"));
  S().hydrate(loadSession());
  assert.equal(S().closedGroups[0].id, entry.id);
  assert.ok(ids.every((id) => !S().tabs[id]));
});


test("unpinning hides only the selected bar entry and persists its History snapshot", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const windowId = setup();
  const { entry } = close(windowId);
  const second = close(windowId, "Other").entry;
  unpinClosedGroup(entry.id, "missing");
  assert.equal(closedGroupsOnBarForProfile(S(), "default").length, 2);
  unpinClosedGroup(entry.id, "default");
  assert.deepEqual(closedGroupsOnBarForProfile(S(), "default").map((group) => group.id), [second.id]);
  assert.equal(closedGroupsForProfile(S(), "default").length, 2);
  assert.equal(S().deletedGroups.length, 0);
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.equal(S().closedGroups.find((group) => group.id === entry.id).hiddenFromBar, true);
  S().restoreClosed(entry.id, windowId);
  assert.ok(Object.values(S().groups).some((group) => group.name === "Research"));
});

test("opening a closed group in a new window retains its profile and has no extra empty tab", () => {
  const original = setup();
  const profileId = S().createProfile({ name: "Work" });
  const work = S().createWindow({ profileId });
  const { entry } = close(work);
  const count = S().windowOrder.length;
  reopenClosedGroupInNewWindow(entry.id, "default");
  assert.equal(S().windowOrder.length, count);
  reopenClosedGroupInNewWindow(entry.id, profileId);
  const made = S().windowOrder.find((id) => id !== original && id !== work);
  assert.equal(S().windows[made].profileId, profileId);
  assert.equal(S().windows[made].tabIds.length, entry.tabs.length);
  assert.ok(S().windows[made].tabIds.every((id) => S().tabs[id].url));
  assert.equal(S().closedGroups.length, 0);
});

test("opening one saved URL keeps the closed group and rejects invalid indices and other profiles", () => {
  const windowId = setup();
  const { entry } = close(windowId);
  const count = S().windows[windowId].tabIds.length;
  for (const index of [-1, 0.5, 99, NaN]) openClosedGroupTab(entry.id, index, windowId);
  const other = S().createWindow({ profileId: S().createProfile({ name: "Other" }) });
  openClosedGroupTab(entry.id, 0, other);
  assert.equal(S().windows[windowId].tabIds.length, count);
  assert.equal(S().windows[other].tabIds.length, 1);
  openClosedGroupTab(entry.id, 1, windowId);
  assert.equal(S().windows[windowId].tabIds.length, count + 1);
  const id = S().windows[windowId].activeTabIds.default;
  assert.equal(S().tabs[id].url, entry.tabs[1].url);
  assert.equal(S().closedGroups[0].id, entry.id);
});

test("version nine closed groups remain visible after the bar visibility migration", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const windowId = setup();
  close(windowId);
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  saved.version = 9;
  saved.closedGroups.forEach((group) => delete group.hiddenFromBar);
  stub.docs.set("session.json", JSON.stringify(saved));
  S().hydrate(loadSession());
  assert.equal(S().closedGroups[0].hiddenFromBar, false);
  assert.equal(closedGroupsOnBarForProfile(S(), "default").length, 1);
});

test("bar groups reuse unchanged inputs and invalidate on group or profile changes", () => {
  const windowId = setup();
  close(windowId);
  const state = S();
  const groups = closedGroupsOnBarForProfile(state, "default");
  assert.equal(groups.length, 1);
  assert.equal(closedGroupsOnBarForProfile({ ...state }, "default"), groups);
  assert.equal(closedGroupsOnBarForProfile(state, "missing").length, 0);
  assert.equal(closedGroupsOnBarForProfile(state, "default"), groups);
  assert.equal(closedGroupsOnBarForProfile({ ...state, profiles: {} }, "default").length, 0);
  assert.equal(closedGroupsOnBarForProfile(state, "default").length, 1);
  unpinClosedGroup(groups[0].id, "default");
  assert.equal(closedGroupsOnBarForProfile(S(), "default").length, 0);
});
