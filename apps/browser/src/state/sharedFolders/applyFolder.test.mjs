import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { groupEntries } = await import("../sidebar/entries.ts");
const { pinKeyOf } = await import("../browser/model.ts");
const { withFolder } = await import("./applyFolder.ts");
const { knownNames, localFolder, signatureOf } = await import("./local.ts");
const { mergeFolder } = await import("./merge.ts");
const { planFiles } = await import("./plan.ts");
const { withSharedGroup } = await import("./actions.ts");
const { folderPlace } = await import("./engine.ts");

const S = () => useBrowser.getState();
const remote = (links, manifest = null) => ({ entries: links.map(([file, url]) => ({ kind: "link", file, url, id: null })), manifest, manifestPending: false });

function sharedWindow() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const a = S().newTab(w, { url: "https://one.example/", background: true });
  const b = S().newTab(w, { url: "https://two.example/", background: true });
  S().updateTab(a, { title: "One" });
  S().updateTab(b, { title: "Two" });
  const g = S().groupTabs([a, b], { pinned: true, name: "Team" });
  return { w, a, b, g };
}

function round(groupId, base, level) {
  const s = S();
  const local = localFolder(s, groupId, knownNames(base));
  const merged = mergeFolder(base, local.entries, level);
  const next = withFolder(s, groupId, merged.level, local);
  if (next !== s) useBrowser.setState(next);
  return { ...planFiles(merged.level, base), changed: next !== s };
}

const rowTitles = (g) => groupEntries(S(), g).map((e) => { const t = S().tabs[e.slice(2)]; return t.customTitle || t.title; });

test("a sidebar folder's links are its pinned tabs, named and keyed so page titles and loads never rename a file", () => {
  const { g, a } = sharedWindow();
  const first = round(g, [], remote([]));
  assert.deepEqual(first.ops.filter((o) => o.op === "write").map((o) => o.path), ["One.webloc", "Two.webloc", ".ardia-folder.json"]);
  S().updateTab(a, { title: "One — now loaded with a long title", url: "https://one.example/inbox" });
  const local = localFolder(S(), g, knownNames(first.base));
  assert.deepEqual(local.entries.map((e) => e.name), ["One", "Two"]);
  assert.equal(local.entries[0].url, "https://one.example/", "the link stays the pinned URL");
});

test("links from the folder become sleeping tabs in it; a deleted one leaves; nothing changes on the next pass", () => {
  const { g, a, b } = sharedWindow();
  S().updateTab(b, { page: { kind: "asleep" } });
  const { base } = round(g, [], remote([]));
  const level = remote([["One.webloc", "https://one.example/"], ["Three.webloc", "https://three.example/"]], ["Three.webloc", "One.webloc"]);
  const second = round(g, base, level);
  assert.deepEqual(rowTitles(g), ["Three", "One"]);
  assert.equal(S().tabs[b], undefined, "the unloaded tab of a deleted link goes");
  const three = S().groups[g].tabIds[0];
  assert.equal(S().tabs[three].page.kind, "asleep");
  assert.equal(S().tabs[three].pinnedUrl, "https://three.example/");
  assert.ok(S().tabs[a]);
  const written = new Map(second.base.map((e) => [e.file, e.id ?? null]));
  const level2 = remote([["One.webloc", "https://one.example/"], ["Three.webloc", "https://three.example/"]], ["Three.webloc", "One.webloc"]);
  for (const e of level2.entries) e.id = written.get(e.file) ?? null;
  const third = round(g, second.base, level2);
  assert.equal(third.changed, false);
  assert.deepEqual(third.ops, []);
});

test("a link deleted elsewhere while its page is open stays open as a regular tab", () => {
  const { w, g, a } = sharedWindow();
  const { base } = round(g, [], remote([]));
  S().activate(a);
  round(g, base, remote([["Two.webloc", "https://two.example/"]], ["Two.webloc"]));
  assert.ok(S().tabs[a], "the open page survives");
  assert.ok(!S().groups[g].tabIds.includes(a));
  assert.ok(S().windows[w].tabIds.includes(a));
});

test("a collaborator's rename renames the tab, and a subfolder becomes a nested folder", () => {
  const { g, a } = sharedWindow();
  const { base } = round(g, [], remote([]));
  const level = {
    entries: [
      { kind: "link", file: "First.webloc", url: "https://one.example/" },
      { kind: "link", file: "Two.webloc", url: "https://two.example/" },
      { kind: "dir", file: "Later", level: remote([["Essay.webloc", "https://essay.example/"]]) },
    ],
    manifest: null,
    manifestPending: false,
  };
  round(g, base, level);
  assert.equal(S().tabs[a].customTitle, "First");
  const nested = Object.values(S().groups).find((x) => x.parentId === g);
  assert.equal(nested?.name, "Later");
  assert.equal(S().tabs[nested.tabIds[0]].title, "Essay");
});

test("an added shared folder starts with an Empty Folder row that gives way to the first link", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const [next, g] = withSharedGroup(S(), w, "Shared");
  useBrowser.setState(next);
  assert.equal(S().groups[g].pinned, true);
  assert.deepEqual(rowTitles(g), ["Empty Folder"]);
  const { base } = round(g, [], remote([]));
  assert.deepEqual(base, []);
  assert.deepEqual(rowTitles(g), ["Empty Folder"]);
  round(g, base, remote([["Docs.webloc", "https://docs.example/"]]));
  assert.deepEqual(rowTitles(g), ["Docs"]);
  assert.equal(folderPlace(S(), S().groups[g].profileId, pinKeyOf(S().groups[g])).kind, "shown");
});

test("a folder that is gone from a shown profile reads as gone; the signature only follows links", () => {
  const { g, a } = sharedWindow();
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  const before = signatureOf(localFolder(S(), g, new Map()));
  S().updateTab(a, { title: "One (3 unread)" });
  assert.notEqual(signatureOf(localFolder(S(), g, new Map())), before, "an unsynced title still counts");
  const named = new Map([[pinKeyOf(S().tabs[a]), "One"]]);
  const synced = signatureOf(localFolder(S(), g, named));
  S().updateTab(a, { title: "One (4 unread)" });
  assert.equal(signatureOf(localFolder(S(), g, named)), synced, "a synced link ignores its page title");
  S().deleteGroup(g);
  assert.equal(folderPlace(S(), profileId, key).kind, "gone");
});
