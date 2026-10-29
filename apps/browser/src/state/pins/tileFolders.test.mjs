import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const folders = await import("./tileFolders.ts");
const { sidebarEntries } = await import("../sidebar/entries.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const act = (fn) => useBrowser.setState(fn(S()), true);
const host = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".com", "");
const cells = (w, profileId) =>
  sidebarEntries(S(), w, profileId).cells.map((c) => {
    const f = folders.folderIdOfCell(c);
    return f ? `[${folders.folderMembers(S(), w, f).map(host).join(",")}]` : host(c);
  });
const folderOf = (id) => S().tabs[id].pin?.folder;
const tileOf = (w, h) => model.viewTabIds(S(), w).find((id) => !!S().tabs[id].pin && host(id) === h);

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

function pinnedWindow() {
  const { w, ids } = windowWith("a", "b", "c", "d", "e");
  S().pinTabs(ids.slice(0, 4), true);
  return { w, ids };
}

test("a tile dropped on another makes a folder of the two in the target's place; another dropped on it joins", () => {
  reset();
  const { w, ids: [a, b, c, d] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [d], b));
  assert.deepEqual(cells(w), ["a", "[b,d]", "c"]);
  assert.equal(folderOf(b).id, folderOf(d).id);
  assert.equal(folderOf(b).name, "");
  assert.deepEqual(model.viewTabIds(S(), w).slice(0, 4).map(host), ["a", "b", "d", "c"], "members sit together, so Chrome's pinned order matches");
  act((s) => folders.addToTileFolder(s, [a], d));
  assert.deepEqual(cells(w), ["[b,d,a]", "c"]);
  act((s) => folders.addToTileFolder(s, [c], b, a));
  assert.deepEqual(cells(w), ["[b,d,c,a]"], "a drop inside the folder lands before the member it was dropped on");
  assert.ok(Object.values(S().tabs).every((t) => !!t.pin === (t.id !== model.viewTabIds(S(), w)[4])), "every member is still a plain pinned tab");
});

test("a list tab dropped on a tile is pinned into the folder", () => {
  reset();
  const { w, ids: [a, , , , e] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [e], a));
  assert.equal(!!S().tabs[e].pin, true);
  assert.equal((S().tabs[e].pin?.as === "row"), false);
  assert.deepEqual(cells(w), ["[a,e]", "b", "c", "d"]);
});

test("New Folder with Tab makes a folder of one, and a folder left with one tab turns back into that tile", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedWindow();
  const { state, folderId } = folders.newTileFolder(S(), [b], "Work");
  act(() => state);
  assert.deepEqual(cells(w), ["a", "[b]", "c", "d"], "a new folder may hold one tab");
  assert.equal(folders.folderIn(S(), w, folderId).name, "Work");
  act((s) => folders.addToTileFolder(s, [c], b));
  assert.deepEqual(cells(w), ["a", "[b,c]", "d"]);
  act((s) => folders.leaveTileFolder(s, [c]));
  assert.deepEqual(cells(w), ["a", "b", "c", "d"]);
  assert.equal(folderOf(b), undefined, "the last one left is a tile again");
});

test("unpinning, moving to the rows or into a group takes a tab out of its folder; an emptied folder is gone", () => {
  reset();
  const { w, ids: [a, b, c, d] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [b, c, d], a));
  assert.deepEqual(cells(w), ["[a,b,c,d]"]);
  S().pinTabs([d], false);
  assert.equal(folderOf(d), undefined);
  S().pinTabs([c], true, true);
  assert.equal(folderOf(c), undefined, "a pinned row is never in a tile folder");
  assert.deepEqual(cells(w), ["[a,b]"]);
  S().togglePin(b);
  assert.deepEqual(cells(w), ["a"], "one left: the folder is gone");
  assert.equal(folderOf(a), undefined);
});

test("closing a member unloads it and keeps it in its folder", () => {
  reset();
  const { w, ids: [a, b] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [b], a));
  S().activate(b);
  S().closeTab(b);
  assert.ok(S().tabs[b], "kept");
  assert.equal(!!S().tabs[b].page.nav || !!S().tabs[b].page.adopt, false, "unloaded");
  assert.deepEqual(cells(w), ["[a,b]", "c", "d"]);
});

test("rename and remove a folder; dragging the folder moves its members together", () => {
  reset();
  const { w, ids: [a, b, c, d] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [c], b));
  const id = folderOf(b).id;
  act((s) => folders.renameTileFolder(s, w, id, "  Reading "));
  assert.deepEqual([folderOf(b).name, folderOf(c).name], ["Reading", "Reading"]);
  assert.equal(folders.folderLabel(folderOf(b)), "Reading");
  S().placeTabs(folders.folderMembers(S(), w, id), { pinned: true, row: false, beforeId: null });
  assert.deepEqual(cells(w), ["a", "d", "[b,c]"], "placed as one, still a folder");
  act((s) => folders.dissolveTileFolder(s, w, id));
  assert.deepEqual(cells(w), ["a", "d", "b", "c"]);
  assert.ok([a, b, c, d].every((t) => !S().tabs[t].pin?.folder));
});

test("folders are the profile's: a second window mirrors them, a change in either shows in the other", () => {
  reset();
  const { w, ids: [a, b] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [b], a));
  const other = S().createWindow({ url: "https://z.com/" });
  assert.deepEqual(cells(other), ["[a,b]", "c", "d"]);
  act((s) => folders.addToTileFolder(s, [tileOf(other, "d")], tileOf(other, "a")));
  assert.deepEqual(cells(w), ["[a,b,d]", "c"]);
  act((s) => folders.renameTileFolder(s, w, folderOf(a).id, "Daily"));
  assert.equal(folderOf(tileOf(other, "b")).name, "Daily");
  S().pinTabs([tileOf(w, "b"), tileOf(w, "d")], false);
  assert.deepEqual(cells(other), ["a", "c"], "unpinned in one window, the folder of one left is gone in both");
  assert.equal(S().tabs[tileOf(other, "a")].pin?.folder, undefined);
});

test("folders park with the last window, come back from it, and survive a relaunch", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w, ids: [a, b, c] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [c], a));
  act((s) => folders.renameTileFolder(s, w, folderOf(a).id, "Mail & Cal"));
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.deepEqual(cells(w), ["[a,c]", "b", "d"]);
  assert.equal(folderOf(a).name, "Mail & Cal");
  S().closeWindow(w);
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => t.pin?.folder?.name ?? null), ["Mail & Cal", "Mail & Cal", null, null]);
  const n = S().createWindow();
  assert.deepEqual(cells(n), ["[a,c]", "b", "d"]);
  assert.ok(b);
});

test("older data: a version 5 session's folder field on a tab that isn't a tile is dropped at launch", () => {
  const tab = (id, u, pinned, extra = {}) => ({ id, windowId: "w", profileId: "default", url: u, title: "", favicon: null, pinned, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: pinned ? u : null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra });
  const folder = { id: "tf-1", name: "" };
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify({
    version: 5,
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    profileOrder: ["default"],
    windows: [{ id: "w", profileId: "default", incognito: false, tabIds: ["t", "r", "u"], activeTabIds: { default: "u" }, sidebarOpen: true, frame: null, createdAt: 0 }],
    windowOrder: ["w"],
    tabs: [tab("t", "https://t.com/", true, { tileFolder: folder }), tab("r", "https://r.com/", true, { pinnedAsRow: true, tileFolder: folder }), tab("u", "https://u.com/", false, { tileFolder: folder })],
    groups: [],
    splits: [],
  }));
  S().hydrate(loadSession());
  assert.deepEqual(S().tabs.t.pin, { as: "tile", folder });
  assert.deepEqual(S().tabs.r.pin, { as: "row" });
  assert.equal(S().tabs.u.pin, null);
});

test("the top strip's pinned dock shows a folder as one cell, the active member right after it, and its menu lists the members", async () => {
  const { stripEntries, tileFolderMenuItems } = await import("../tabs/topStrip.ts");
  reset();
  const { w, ids: [a, b, c, d] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [c, d], b));
  const fid = folderOf(b).id;
  const dock = () =>
    stripEntries(S(), w, "default").flatMap((e) =>
      e.kind === "dock" ? e.ids.map((cell) => (e.members.has(cell) ? `tilefolder:${folders.folderIdOfCell(cell)}:${e.members.get(cell).join(",")}` : `pinned:${cell}`)) : [],
    );
  assert.deepEqual(dock(), [`pinned:${a}`, `tilefolder:${fid}:${b},${c},${d}`]);
  S().activate(c);
  assert.deepEqual(dock(), [`pinned:${a}`, `tilefolder:${fid}:${b},${c},${d}`, `pinned:${c}`]);
  const items = tileFolderMenuItems(S(), w, fid, c);
  assert.deepEqual(items.slice(0, 3).map((i) => [i.value.tabId, !!i.checked]), [[b, false], [c, true], [d, false]]);
  assert.equal(items.at(-1).id, "rename");
});

test("a member moved to another profile leaves the folder; a folder left with one tab there is that tile again", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [b], a));
  const work = S().createProfile({ name: "Work" });
  S().moveTabToProfile(b, work);
  assert.equal(S().tabs[b].profileId, work);
  assert.equal(folderOf(b), undefined, "no folder in the other profile");
  assert.equal(folderOf(a), undefined, "the one left is a tile again");
  assert.deepEqual(cells(w, "default"), ["a", "c", "d"]);
  act((s) => folders.addToTileFolder(s, [c], a));
  const id = folderOf(a).id;
  useBrowser.setState({ tabs: { ...S().tabs, [b]: { ...S().tabs[b], tileFolder: { id, name: "" } } } });
  assert.deepEqual(folders.folderMembers(S(), w, id).map(host), ["a", "c"], "another profile's tab with the same folder id isn't a member");
});

test("a parked folder that drops to one tab is that tile when it comes back", () => {
  reset();
  const { w, ids: [a, b] } = pinnedWindow();
  act((s) => folders.addToTileFolder(s, [b], a));
  S().closeWindow(w);
  const park = S().parkedPins.default;
  const key = S().tabs[b]?.pinKey ?? b;
  useBrowser.setState({ parkedPins: { ...S().parkedPins, default: { ...park, tabs: park.tabs.filter((p) => p.id !== key) } } });
  assert.ok(S().parkedPins.default.tabs.every((p) => !p.pin?.folder), JSON.stringify(S().parkedPins.default.tabs.map((p) => p.pin?.folder ?? null)));
  const n = S().createWindow();
  assert.deepEqual(cells(n), ["a", "c", "d"]);
});
