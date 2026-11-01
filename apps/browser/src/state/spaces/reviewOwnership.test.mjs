import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";
import { useBrowser } from "../browser/store.ts";
import { pinKeyOf, snapshotTab, viewTabIds } from "../browser/model.ts";
import { restoreSnapshots } from "../pins/closedTabs.ts";
import { sidebarEntries } from "../sidebar/entries.ts";
import { PageSpaceContext } from "../browser/hooks.ts";
import { useShownFolderTab } from "../pins/hooks.ts";
import { ardiaCoreNativeModules } from "../../test-native/ardiacore.ts";

const S = () => useBrowser.getState();
const reset = () => { S().hydrate({}); return S().createWindow({ url: "https://start.test/" }); };

test("restoring a tab from a deleted Space uses the destination Space", () => {
  const w = reset();
  const saved = { ...snapshotTab(S().tabs[S().windows[w].tabIds[0]]), spaceId: "deleted-space" };
  const [next, ids] = restoreSnapshots(S(), w, [{ tab: saved }]);
  assert.equal(next.tabs[ids[0]].spaceId, "default");
  assert.ok(viewTabIds(next, w).includes(ids[0]));
});

test("shared Top Apps remain visible when switching Spaces while saved rows stay separate", () => {
  const w = reset();
  const other = S().createSpace({ name: "Other", profileId: "default" });
  const tile = S().newTab(w, { url: "https://shared-tile.test/", pinned: true });
  const row = S().newTab(w, { url: "https://local-row.test/", pinned: true, pinnedAsRow: true });
  const key = pinKeyOf(S().tabs[tile]);
  assert.ok(sidebarEntries(S(), w, other).tiles.some((id) => pinKeyOf(S().tabs[id]) === key));
  assert.ok(!sidebarEntries(S(), w, other).pinned.includes(`t:${row}`));
  S().switchSpace(w, other);
  assert.ok(sidebarEntries(S(), w).tiles.some((id) => pinKeyOf(S().tabs[id]) === key));
  assert.ok(!sidebarEntries(S(), w).pinned.includes(`t:${row}`));
});

test("bookmarking an inactive Space's group keeps its browsing Profile", () => {
  const w = reset();
  const profileId = S().createProfile({ name: "Work" });
  const spaceId = S().createSpace({ name: "Work", profileId });
  const tab = S().newTab(w, { spaceId, url: "https://group-owner.test/" });
  const group = S().createGroup([tab], { name: "Work group" });
  S().switchSpace(w, "default");
  S().moveGroupToBookmarksBar(group);
  const node = Object.values(S().bookmarks.nodes).find((n) => n.url === "https://group-owner.test/");
  assert.ok(node);
  assert.equal(S().bookmarks.nodes[node.parentId].parentId, `bar@${profileId}`);
});

test("folder tiles on inactive pages use that page's remembered active tab", () => {
  const w = reset();
  const profileId = S().createProfile({ name: "Work" });
  const other = S().createSpace({ name: "Work", profileId });
  const first = S().newTab(w, { spaceId: "default", url: "https://personal-folder.test/", pinned: true });
  const second = S().newTab(w, { spaceId: other, url: "https://work-folder.test/", pinned: true });
  const folder = { id: "same-folder-key", name: "Folder" };
  useBrowser.setState({ tabs: { ...S().tabs, [first]: { ...S().tabs[first], pin: { as: "tile", folder } }, [second]: { ...S().tabs[second], pin: { as: "tile", folder } } } });
  S().activate(first);
  S().activate(second);
  const page = mount(() => useShownFolderTab(w, folder.id), { contexts: [[PageSpaceContext, "default"]] });
  assert.equal(page.value, first);
  page.unmount();
});

test("Profile bookmark exports support an identity with zero Spaces", async (t) => {
  reset();
  const profileId = S().createProfile({ name: "Unused" });
  const calls = [];
  t.mock.method(ardiaCoreNativeModules.ArdiaBookmarks, "call", async (name, profile) => { calls.push([name, profile]); return JSON.stringify("/tmp/bookmarks.html"); });
  const { exportProfileBookmarks } = await import("../bookmarks/exportHtml.ts");
  assert.equal(await exportProfileBookmarks(profileId), "/tmp/bookmarks.html");
  assert.deepEqual(calls, [["exportHtml", profileId]]);
});

test("casting starts watching a newly selected or reassigned browsing Profile", async (t) => {
  const w = reset();
  const profileId = S().createProfile({ name: "Cast Work" });
  const other = S().createSpace({ name: "Cast Work", profileId });
  const calls = [];
  t.mock.method(ardiaCoreNativeModules.ArdiaMedia, "call", async (name, profile) => { if (name === "watchCastRoutes") calls.push(profile); return "null"; });
  const { startCast } = await import("../media/cast.ts");
  startCast();
  S().switchSpace(w, other);
  assert.ok(calls.includes(profileId));
  const reassigned = S().createProfile({ name: "Cast School" });
  S().assignSpaceProfile(other, reassigned);
  assert.ok(calls.includes(reassigned));
});

test("the omnibox New Space choice creates a destination before moving its tab", async (t) => {
  const w = reset();
  const tabId = S().windows[w].tabIds[0];
  const { shellNativeModules } = await import("../../test-native/shell.ts");
  t.mock.method(shellNativeModules.ArdiaMenus, "showMenu", async () => "new");
  const { runBarAction } = await import("../omnibox/runBar.ts");
  const { takeCreateSpaceSheet, endCreateSpaceRequest } = await import("./createSpaceRequest.ts");
  runBarAction("space:moveTab", w);
  await new Promise(setImmediate);
  const request = takeCreateSpaceSheet();
  assert.ok(request);
  assert.equal(request.windowId, w);
  const destination = S().createSpace({ name: "New destination", profileId: "default" });
  endCreateSpaceRequest(request, destination);
  await new Promise(setImmediate);
  assert.equal(S().tabs[tabId].spaceId, destination);
});
