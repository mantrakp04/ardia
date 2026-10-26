import assert from "node:assert/strict";
import { test } from "node:test";
import { docs } from "../../test-native/index.ts";

const savedBeforeOptions = { id: "old", profileId: "p", kind: "pullRequests", name: "PRs", icon: null, collapsed: false, sources: [], filters: { authored: true, reviewRequests: true }, createdAt: 0 };
docs.set("live.json", JSON.stringify({ folders: { old: savedBeforeOptions }, folderOrder: ["old"] }));
const { manualRefresh, refreshFolder } = await import("./engine.ts");
const { SOURCES } = await import("./sources.ts");
const { folderRows, liveTabPlace } = await import("./rows.ts");
const { applyFetch, createFolder, finishCompleting, hideItems, live, setLive, updateFolder } = await import("./store.ts");

const pr = (id, number, headRef, baseRef) => ({
  id,
  source: "github",
  url: `https://github.com/o/r/pull/${number}`,
  title: `PR ${number}`,
  subtitle: "",
  icon: null,
  updatedAt: 0,
  section: "authored",
  pr: { number, repo: "o/r", headRef, baseRef, stack: undefined },
});

const stacked = [
  { ...pr("a", 1, "one", "main"), pr: { ...pr("a", 1, "one", "main").pr, stack: { id: "stack:a", position: 1, size: 2 } } },
  { ...pr("b", 2, "two", "one"), pr: { ...pr("b", 2, "two", "one").pr, stack: { id: "stack:a", position: 2, size: 2 } } },
  pr("c", 3, "three", "main"),
];

test("with stacks grouped, a stack is one row holding its pull requests in order", () => {
  const rows = folderRows({ id: "f", kind: "pullRequests", groupStacks: true }, stacked, {});
  assert.deepEqual(
    rows.map((r) => (r.kind === "stack" ? `stack:${r.items.map((i) => i.id).join(",")}` : r.key)),
    ["stack:a,b", "c"],
  );
});

test("with stacks ungrouped, each stacked pull request is its own row", () => {
  const rows = folderRows({ id: "f", kind: "pullRequests", groupStacks: false }, stacked, {});
  assert.deepEqual(rows.map((r) => `${r.kind}:${r.key}`), ["item:a", "item:b", "item:c"]);
});

test("a folder saved before these options existed loads with stacks grouped and completed pull requests shown", () => {
  assert.equal(live().folders.old.groupStacks, true);
  assert.equal(live().folders.old.showCompleted, true);
});

test("a hidden pull request stays out of the folder through later fetches until a manual refresh", async () => {
  const id = createFolder("p", "pullRequests", []);
  applyFetch(id, stacked, {});
  setLive((s) => ({ unread: { ...s.unread, [id]: ["a", "c"] } }));
  const shown = () => live().items[id].map((it) => it.id);
  hideItems(id, [stacked[0]]);
  assert.deepEqual(shown(), ["b", "c"]);
  assert.deepEqual(live().unread[id], ["c"], "hiding also clears the hidden row's unread pip");

  applyFetch(id, stacked, {});
  assert.deepEqual(shown(), ["b", "c"], "a fetch that still returns the hidden pull request keeps it out");

  const refreshing = manualRefresh(id);
  assert.deepEqual(shown().sort(), ["a", "b", "c"], "a manual refresh shows hidden pull requests at once, before its fetch lands");
  assert.equal(live().hidden[id], undefined);
  await refreshing;
  applyFetch(id, stacked, {});
  assert.deepEqual(shown(), ["a", "b", "c"], "and the next fetch that lists them keeps them");
});

test("hiding a pull request while its merge plays keeps it out of Completed", () => {
  const id = createFolder("p", "pullRequests", []);
  applyFetch(id, stacked, {});
  applyFetch(id, stacked.filter((it) => it.id !== "c"), { c: "merged" });
  hideItems(id, [stacked[2]]);
  finishCompleting(id, ["c"]);
  assert.deepEqual(live().completed[id], []);
  assert.deepEqual(live().completing[id], []);
});

test("every hidden pull request stays hidden however many are hidden before a manual refresh", () => {
  const id = createFolder("p", "pullRequests", []);
  const many = Array.from({ length: 700 }, (_, i) => pr(`x${i}`, i, `h${i}`, "main"));
  applyFetch(id, many, {});
  for (const it of many) hideItems(id, [it]);
  applyFetch(id, many, {});
  assert.deepEqual(live().items[id], []);
});

test("a hidden pull request that merges stops counting as hidden; one that only drops out of a fetch stays hidden", () => {
  const id = createFolder("p", "pullRequests", []);
  applyFetch(id, stacked, {});
  hideItems(id, [stacked[1], stacked[2]]);
  applyFetch(id, [stacked[0]], { c: "merged" });
  assert.deepEqual(live().hidden[id].map((it) => it.id), ["b"]);
  assert.deepEqual(live().completed[id], [], "a pull request that merged while hidden doesn't show under Completed");
});

const bitbucket = (id) => ({ ...pr(id, 1, `h-${id}`, "main"), source: "bitbucket" });

test("a manual refresh whose fetch fails keeps the pull requests it unhid", async () => {
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  applyFetch(id, [bitbucket("x"), bitbucket("y")], {});
  hideItems(id, [bitbucket("x")]);
  await manualRefresh(id);
  assert.equal(live().status[id].error?.source, "bitbucket", "the fetch failed: Bitbucket isn't connected in tests");
  assert.deepEqual(live().items[id].map((it) => it.id).sort(), ["x", "y"]);
});

test("a hidden pull request that drops out of a fetch stays hidden while its source can't say it closed", async () => {
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  applyFetch(id, [bitbucket("x")], {});
  hideItems(id, [bitbucket("x")]);
  updateFolder(id, { filters: { authored: false, reviewRequests: true } });
  await refreshFolder(id);
  assert.deepEqual(live().hidden[id].map((it) => it.id), ["x"]);
});

test("a manual refresh during an automatic one keeps what it unhid when the fetch fails", async () => {
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  applyFetch(id, [bitbucket("x"), bitbucket("y")], {});
  hideItems(id, [bitbucket("x")]);
  const automatic = refreshFolder(id);
  const manual = manualRefresh(id);
  await Promise.all([automatic, manual]);
  assert.deepEqual(live().items[id].map((it) => it.id).sort(), ["x", "y"]);
});

test("a refresh doesn't ask whether pull requests its filters leave out have closed", async () => {
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  applyFetch(id, [bitbucket("x"), bitbucket("y")], {});
  hideItems(id, [bitbucket("x")]);
  updateFolder(id, { filters: { authored: false, reviewRequests: true } });
  const asked = [];
  const resolveGone = SOURCES.bitbucket.resolveGone;
  SOURCES.bitbucket.resolveGone = async (items) => (asked.push(...items.map((it) => it.id)), { x: "merged", y: "merged" });
  try {
    await refreshFolder(id);
  } finally {
    SOURCES.bitbucket.resolveGone = resolveGone;
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(live().hidden[id].map((it) => it.id), ["x"]);
  assert.deepEqual(live().completed[id], [], "rows a filter turned off don't show up as completed");
});

test("a hidden review request only leaves the hidden list when it closed, not when it may have been reviewed", () => {
  const id = createFolder("p", "pullRequests", []);
  const review = { ...pr("r", 9, "h-r", "main"), section: "review" };
  applyFetch(id, [review], {});
  hideItems(id, [review]);
  applyFetch(id, [], { r: "reviewed" });
  assert.deepEqual(live().hidden[id].map((it) => it.id), ["r"]);
});

test("a refresh doesn't ask about hidden pull requests from a source the folder no longer fetches", async () => {
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  applyFetch(id, [bitbucket("x")], {});
  hideItems(id, [bitbucket("x")]);
  updateFolder(id, { sources: ["github"] });
  const asked = [];
  const resolveGone = SOURCES.bitbucket.resolveGone;
  SOURCES.bitbucket.resolveGone = async (items) => (asked.push(...items.map((it) => it.id)), { x: "merged" });
  try {
    await refreshFolder(id);
  } finally {
    SOURCES.bitbucket.resolveGone = resolveGone;
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(live().hidden[id].map((it) => it.id), ["x"]);
});

test("an open tab of a hidden pull request stays out of the folder instead of coming back as a stray row", () => {
  const id = createFolder("p", "pullRequests", []);
  applyFetch(id, stacked, {});
  hideItems(id, [stacked[0]]);
  const shown = new Set(live().items[id].map((it) => it.id));
  const hidden = new Set(live().hidden[id].map((it) => it.id));
  assert.equal(liveTabPlace("a", shown, hidden), "hidden");
  assert.equal(liveTabPlace("b", shown, hidden), "row");
  assert.equal(liveTabPlace("gone", shown, hidden), "stray", "a tab whose pull request left the fetch still shows as its own row");
});
