import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { canTidyPins, tidyPlan, tidyingPins, untidyingPins } = await import("./tidyPins.ts");
const { splitTabIdsOf } = await import("../splits/splits.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const home = (id) => S().tabs[id].pinnedUrl || S().tabs[id].url;
const label = (id) => {
  const u = new URL(home(id));
  return `${u.hostname.split(".")[0]}${u.pathname.replace(/\/$/, "")}`;
};
const innermost = (id) => {
  const depth = (g) => (g.parentId && S().groups[g.parentId] ? 1 + depth(S().groups[g.parentId]) : 0);
  return Object.values(S().groups).filter((g) => g.tabIds.includes(id)).sort((a, z) => depth(z) - depth(a))[0];
};
const path = (g) => (g.parentId && S().groups[g.parentId] ? `${path(S().groups[g.parentId])}/${g.name}` : g.name);
const pinnedArea = (w) =>
  model
    .viewTabIds(S(), w)
    .filter((id) => model.inPinnedContainer(S(), id) && model.pinSection(S().tabs[id]) !== "tile")
    .map((id) => (!!S().tabs[id].pin ? `row:${label(id)}` : `${path(innermost(id))}:${label(id)}`));

function windowWith(...urls) {
  const w = S().createWindow({ url: "https://home.com/" });
  const ids = urls.map((url) => S().newTab(w, { url, background: true }));
  return { w, ids };
}

function tidy(w) {
  let done = null;
  useBrowser.setState((s) => {
    const [next, tidied] = tidyingPins(s, w);
    done = tidied;
    return next;
  });
  return done;
}

const undo = (tidied) => useBrowser.setState((s) => untidyingPins(s, tidied));

test("duplicate rows: the higher one stays, the same page with a fragment counts as the same", () => {
  reset();
  const { w, ids: [a1, b, a2, c] } = windowWith("https://a.com/x", "https://b.com/", "https://a.com/x#top", "https://c.com/");
  S().pinTabs([a1, b, a2, c], true, true);
  assert.deepEqual(pinnedArea(w), ["row:a/x", "row:b", "row:a/x", "row:c"]);
  const done = tidy(w);
  assert.deepEqual(pinnedArea(w), ["row:a/x", "row:b", "row:c"]);
  assert.equal(!!S().tabs[a1].pin, true);
  assert.equal(S().tabs[a2], undefined);
  assert.equal(done.duplicates, 1);
  assert.equal(done.pins, 0);
});

test("a pin inside a folder wins over a loose one, even a higher one", () => {
  reset();
  const { w, ids: [loose, member] } = windowWith("https://b.com/", "https://b.com/");
  S().groupTabs([member], { pinned: true, name: "Mine" });
  S().pinTabs([loose], true, true);
  assert.deepEqual(pinnedArea(w), ["row:b", "Mine:b"]);
  tidy(w);
  assert.deepEqual(pinnedArea(w), ["Mine:b"]);
  assert.ok(S().tabs[member]);
});

test("loose pins go into the folder whose most common site is theirs, at half or more; the higher folder wins a tie", () => {
  reset();
  const { w, ids } = windowWith(
    "https://linkedin.com/1",
    "https://greenhouse.io/1",
    "https://linkedin.com/2",
    "https://lever.co/1",
    "https://ashbyhq.com/1",
    "https://linkedin.com/3",
    "https://linkedin.com/9",
    "https://greenhouse.io/2",
    "https://lever.co/2",
  );
  const [j1, j2, m1, m2, m3, k1, r1, r2, r3] = ids;
  S().groupTabs([j1, j2], { pinned: true, name: "Jobs" });
  S().groupTabs([m1, m2, m3], { pinned: true, name: "Mixed" });
  S().groupTabs([k1], { pinned: true, name: "Work" });
  S().pinTabs([r1, r2, r3], true, true);
  assert.deepEqual(pinnedArea(w), [
    "row:linkedin/9",
    "row:greenhouse/2",
    "row:lever/2",
    "Jobs:linkedin/1",
    "Jobs:greenhouse/1",
    "Mixed:linkedin/2",
    "Mixed:lever/1",
    "Mixed:ashbyhq/1",
    "Work:linkedin/3",
  ]);
  const done = tidy(w);
  assert.deepEqual(pinnedArea(w), [
    "row:lever/2",
    "Jobs:linkedin/1",
    "Jobs:greenhouse/1",
    "Jobs:linkedin/9",
    "Jobs:greenhouse/2",
    "Mixed:linkedin/2",
    "Mixed:lever/1",
    "Mixed:ashbyhq/1",
    "Work:linkedin/3",
  ]);
  assert.equal(done.pins, 2);
  assert.equal(done.folders, 1);
  assert.equal(Object.values(S().groups).find((g) => g.tabIds.includes(j1)).name, "Jobs", "never renamed");
});

test("nested folders count on their own", () => {
  reset();
  const { w, ids } = windowWith(
    "https://example.com/1",
    "https://linkedin.com/1",
    "https://linkedin.com/2",
    "https://example.com/2",
    "https://linkedin.com/9",
    "https://example.com/9",
  );
  const [o1, i1, i2, o2, r1, r2] = ids;
  S().groupTabs([o1, i1, i2, o2], { pinned: true, name: "Outer" });
  S().groupTabs([i1, i2], { name: "Inner" });
  S().pinTabs([r1, r2], true, true);
  tidy(w);
  assert.deepEqual(pinnedArea(w), [
    "Outer:example/1",
    "Outer/Inner:linkedin/1",
    "Outer/Inner:linkedin/2",
    "Outer/Inner:linkedin/9",
    "Outer:example/2",
    "Outer:example/9",
  ]);
});

test("two or more loose pins of one site make a folder where the first was, named after the site; singles stay", () => {
  reset();
  const { w, ids: [g1, l1, f1, l2] } = windowWith("https://github.com/1", "https://www.linkedin.com/1", "https://figma.com/1", "https://jobs.linkedin.com/2");
  S().pinTabs([g1, l1, f1, l2], true, true);
  S().updateTab(l1, { title: "Jobs | LinkedIn" });
  S().updateTab(l2, { title: "Feed | LinkedIn" });
  const done = tidy(w);
  assert.deepEqual(pinnedArea(w), ["row:github/1", "LinkedIn:www/1", "LinkedIn:jobs/2", "row:figma/1"]);
  const made = innermost(l1);
  assert.equal(made.pinned, true);
  assert.equal(made.name, "LinkedIn");
  assert.equal(done.pins, 2);
  assert.equal(done.folders, 1);
});

test("a new folder takes the site's own spelling from a title that is just the site's name", () => {
  reset();
  const { w, ids: [l1, l2] } = windowWith("https://www.linkedin.com/1", "https://www.linkedin.com/2");
  S().pinTabs([l1, l2], true, true);
  S().updateTab(l1, { title: "LinkedIn" });
  S().updateTab(l2, { title: "LinkedIn" });
  tidy(w);
  assert.equal(innermost(l1).name, "LinkedIn");
});

test("Tidy shows only with something to tidy, and a tidy sidebar has nothing left", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("https://a.com/1", "https://b.com/1", "https://a.com/2");
  S().pinTabs([a, b], true, true);
  assert.equal(canTidyPins(S(), w), false, "two singles");
  assert.equal(tidyPlan(S(), w), null);
  S().pinTabs([c], true);
  assert.equal(canTidyPins(S(), w), false, "Top Apps tiles are never touched");
  S().placeTabs([c], { pinned: true, row: true });
  assert.equal(canTidyPins(S(), w), true);
  tidy(w);
  assert.equal(canTidyPins(S(), w), false);
});

test("Undo puts every pin back in its old place and order, removes Tidy's folders and brings back duplicates", () => {
  reset();
  const { w, ids } = windowWith(
    "https://linkedin.com/1",
    "https://figma.com/1",
    "https://notion.so/1",
    "https://linkedin.com/9",
    "https://figma.com/2",
    "https://notion.so/1#a",
    "https://github.com/1",
    "https://figma.com/3",
  );
  const [j1, ...rows] = ids;
  S().groupTabs([j1], { pinned: true, name: "Jobs" });
  S().pinTabs(rows, true, true);
  S().placeTabs([rows.at(-1)], { pinned: true, row: true, last: true });
  const before = pinnedArea(w);
  const homes = rows.map((id) => S().tabs[id].pinnedUrl);
  const closedBefore = S().closedTabs.length;
  const done = tidy(w);
  assert.notDeepEqual(pinnedArea(w), before);
  assert.ok(Object.values(S().groups).some((g) => g.name === "Figma"));
  undo(done);
  assert.deepEqual(pinnedArea(w), before);
  assert.ok(!Object.values(S().groups).some((g) => g.name === "Figma"), "Tidy's folder is gone");
  const rowIds = model.viewTabIds(S(), w).filter((id) => model.isPinnedRow(S().tabs[id]));
  assert.deepEqual(rowIds.map((id) => S().tabs[id].pinnedUrl), homes, "homes back, the duplicate's too");
  assert.equal(S().closedTabs.length, closedBefore, "the duplicate isn't left in Recently Closed");
});

test("a second window of the profile shows the tidied pins", () => {
  reset();
  const { w: a, ids: [l1, l2] } = windowWith("https://linkedin.com/1", "https://linkedin.com/2");
  S().pinTabs([l1, l2], true, true);
  const b = S().createWindow({ url: "https://other.com/" });
  assert.deepEqual(pinnedArea(b), ["row:linkedin/1", "row:linkedin/2"]);
  tidy(a);
  assert.deepEqual(pinnedArea(a), ["Linkedin:linkedin/1", "Linkedin:linkedin/2"]);
  assert.deepEqual(pinnedArea(b), pinnedArea(a));
});

test("private windows have nothing to tidy and write nothing", () => {
  reset();
  const p = S().createWindow({ kind: "private", url: "https://secret.com/" });
  S().newTab(p, { url: "https://secret.com/2", background: true });
  const s = S();
  assert.equal(tidyPlan(s, p), null);
  assert.equal(canTidyPins(s, p), false);
  assert.equal(tidyingPins(s, p)[0], s);
});

const splitOfTab = (id) => Object.values(S().splits).find((v) => splitTabIdsOf(v).includes(id));

test("Undo gives a split pane that Tidy moved along with its partner its own pinned URL back", () => {
  reset();
  const { w, ids: [a1, b, a2] } = windowWith("https://a.com/1", "https://b.com/home", "https://a.com/2");
  const splitId = S().createSplit([a1, b]);
  S().pinTabs([a1], true, true);
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/home");
  S().updateTab(b, { url: "https://b.com/article" });
  S().pinTabs([a2], true, true);
  const done = tidy(w);
  assert.ok(done);
  undo(done);
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/home", "the pane's home, not the page it's on");
  assert.equal(!!S().tabs[b].pin && (S().tabs[b].pin?.as === "row"), true);
  assert.equal(!!S().tabs[a1].pin && (S().tabs[a1].pin?.as === "row"), true);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [a1, b], "still a split");
});

test("a pane of a pinned split is never closed as a duplicate, so the split survives Tidy and its Undo", () => {
  reset();
  const { w, ids: [p1, p2, member] } = windowWith("https://a.com/1", "https://a.com/2", "https://a.com/1");
  S().groupTabs([member], { pinned: true, name: "F" });
  const splitId = S().createSplit([p1, p2]);
  S().pinTabs([p1], true, true);
  assert.equal((S().tabs[p2].pin?.as === "row"), true);
  const done = tidy(w);
  assert.ok(S().tabs[p1], "the pane stays");
  assert.deepEqual(splitTabIdsOf(splitOfTab(p1)), [p1, p2], "the split stays");
  if (done) undo(done);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [p1, p2]);
  assert.equal(!!S().tabs[p1].pin && (S().tabs[p1].pin?.as === "row"), true);
  assert.equal(!!S().tabs[p2].pin && (S().tabs[p2].pin?.as === "row"), true);
  assert.deepEqual(Object.values(S().groups).find((g) => g.name === "F").tabIds, [member]);
});

test("Undo puts a pinned split back in its place, as one row", () => {
  reset();
  const { w, ids: [a1, b, z, a2, c] } = windowWith("https://a.com/1", "https://b.com/1", "https://z.com/1", "https://a.com/2", "https://c.com/1");
  const splitId = S().createSplit([a1, b]);
  S().pinTabs([a1, z, a2, c], true, true);
  const before = pinnedArea(w);
  assert.deepEqual(before, ["row:a/1", "row:b/1", "row:z/1", "row:a/2", "row:c/1"]);
  const done = tidy(w);
  assert.ok(done);
  undo(done);
  assert.deepEqual(pinnedArea(w), before);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [a1, b]);
});
