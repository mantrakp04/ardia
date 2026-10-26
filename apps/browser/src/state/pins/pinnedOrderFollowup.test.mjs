import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { live, createFolder, removeFolder, updateFolder } = await import("../live/store.ts");
const order = await import("../sidebar/pinnedOrder.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].url).hostname.replace(".example", "");

function start(...names) {
  S().hydrate({});
  for (const id of Object.keys(live().folders)) removeFolder(id);
  const w = S().createWindow({ url: "https://home.example/" });
  const ids = Object.fromEntries(names.map((n) => [n, S().newTab(w, { url: `https://${n}.example/`, background: true })]));
  return { w, ids };
}

const sequence = (w) =>
  order.pinnedSequence(S(), live().folders, live().folderOrder, w, "default").map((e) => {
    const id = e.slice(e.indexOf(":") + 1);
    if (e.startsWith("lf:")) return live().folders[id].name;
    if (e.startsWith("g:")) return S().groups[id].name;
    return host(id);
  });

test("a pinned group closed and reopened from Recently Closed comes back where it was among the rows", () => {
  const { w, ids } = start("r1", "m", "r2");
  S().placeTabs([ids.r1], { pinned: true, row: true, beforeId: null });
  const g = S().groupTabs([ids.m], { pinned: true, name: "Group" });
  S().placeTabs([ids.r2], { pinned: true, row: true, beforeId: null, last: true });
  assert.deepEqual(sequence(w), ["r1", "Group", "r2"]);
  S().closeGroup(g);
  S().restoreClosed(S().closedGroups.at(-1).id, w);
  assert.deepEqual(sequence(w), ["r1", "Group", "r2"]);
});

function rows(...names) {
  const { w, ids } = start(...names);
  S().placeTabs(names.map((n) => ids[n]), { pinned: true, row: true, beforeId: null });
  return { w, ids };
}

function folder(name, after) {
  const id = createFolder("default", "pullRequests");
  updateFolder(id, { name, ...(after === undefined ? {} : { after }) });
  return id;
}

test("unpinning a live folder's anchor right after the folder was made and moved keeps it in place", () => {
  const { w, ids } = rows("r1", "r2", "r3");
  const lf = folder("LF");
  assert.deepEqual(sequence(w), ["r1", "r2", "r3", "LF"]);
  order.moveLiveFolder(w, lf, -1);
  assert.deepEqual(sequence(w), ["r1", "r2", "LF", "r3"]);
  S().pinTabs([ids.r2], false);
  assert.deepEqual(sequence(w), ["r1", "LF", "r3"]);
});

test("after another Mac's reorder, folders whose anchors merge keep the order they were shown in", () => {
  const { w, ids } = rows("a", "b", "c");
  folder("LF1", `t:${ids.a}`);
  folder("LF2", `t:${ids.b}`);
  assert.deepEqual(sequence(w), ["a", "LF1", "b", "LF2", "c"]);
  S().placeTabs([ids.b], { pinned: true, row: true, beforeId: ids.a });
  assert.deepEqual(sequence(w), ["b", "LF2", "a", "LF1", "c"]);
  S().pinTabs([ids.a], false);
  assert.deepEqual(sequence(w), ["b", "LF2", "LF1", "c"]);
});

test("a drop doesn't bring back an anchor that was unpinned while the folder was held", () => {
  const { w, ids } = rows("a", "b", "c");
  const lf = folder("LF", `t:${ids.b}`);
  assert.deepEqual(sequence(w), ["a", "b", "LF", "c"]);
  const held = [`t:${ids.a}`, `t:${ids.b}`, `lf:${lf}`, `t:${ids.c}`];
  S().pinTabs([ids.b], false);
  assert.deepEqual(sequence(w), ["a", "LF", "c"]);
  order.arrangeLive(held);
  assert.deepEqual(sequence(w), ["a", "LF", "c"]);
});

test("unpinning the last row a live folder follows moves the folder to the top, so a new row goes after it", () => {
  const { w, ids } = rows("row", "fresh");
  S().pinTabs([ids.fresh], false);
  folder("LF", `t:${ids.row}`);
  assert.deepEqual(sequence(w), ["row", "LF"]);
  S().pinTabs([ids.row], false);
  assert.deepEqual(sequence(w), ["LF"]);
  S().placeTabs([ids.fresh], { pinned: true, row: true, beforeId: null, last: true });
  assert.deepEqual(sequence(w), ["LF", "fresh"]);
});

test("a drop doesn't bring back an anchor that moved to another profile while the folder was held", () => {
  const { w, ids } = rows("a", "b", "c");
  const lf = folder("LF", `t:${ids.b}`);
  const other = S().createProfile({ name: "Work" });
  const held = [`t:${ids.a}`, `t:${ids.b}`, `lf:${lf}`, `t:${ids.c}`];
  S().moveTabToProfile(ids.b, other);
  assert.equal(S().tabs[ids.b].profileId, other);
  assert.ok(S().tabs[ids.b].pinned && S().tabs[ids.b].pinnedAsRow, "still a pinned row, in the other profile");
  order.arrangeLive(held);
  assert.deepEqual(sequence(w), ["a", "LF", "c"]);
});

test("deleting another folder during a held drag doesn't move the folder that's left", () => {
  const { w, ids } = rows("a", "b", "c");
  const lf1 = folder("LF1", `t:${ids.a}`);
  const lf2 = folder("LF2", `t:${ids.b}`);
  assert.deepEqual(sequence(w), ["a", "LF1", "b", "LF2", "c"]);
  const held = [`t:${ids.a}`, `lf:${lf1}`, `t:${ids.b}`, `lf:${lf2}`, `t:${ids.c}`];
  removeFolder(lf1);
  order.arrangeLive(held);
  assert.deepEqual(sequence(w), ["a", "b", "LF2", "c"]);
});

test("collapsing a group in a long pinned list costs the order listener nothing", async () => {
  const { noteOrderChoices } = await import("./pinOrderChoices.ts");
  const { w } = start();
  const ids = [];
  for (let i = 0; i < 3000; i++) ids.push(S().newTab(w, { url: `https://r${i}.example/`, background: true }));
  S().placeTabs(ids, { pinned: true, row: true, beforeId: null });
  const member = S().newTab(w, { url: "https://member.example/", background: true });
  const g = S().groupTabs([member], { pinned: true, name: "Group" });
  const prev = S();
  S().updateGroup(g, { collapsed: true });
  const now = S();
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) noteOrderChoices(now, prev);
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 1, `${ms.toFixed(2)} ms`);
});
