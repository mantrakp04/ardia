import assert from "node:assert/strict";
import { test } from "node:test";
import { docs } from "../../test-native/index.ts";

const savedBeforeOptions = { id: "old", profileId: "p", kind: "pullRequests", name: "PRs", icon: null, collapsed: false, sources: [], filters: { authored: true, reviewRequests: true }, createdAt: 0 };
docs.set("live.json", JSON.stringify({ folders: { old: savedBeforeOptions }, folderOrder: ["old"] }));
const { manualRefresh, refreshFolder } = await import("./engine.ts");
const { SOURCES } = await import("./sources.ts");
const { folderRows, liveTabPlace } = await import("./rows.ts");
const { liveFolderMenuItems } = await import("../sidebar/liveMenus.ts");
const { applyFetch, createFolder, finishCompleting, hideItems, live, markUnread, removeFolder, setRepoHidden, showAllIn, toggleStack, updateFolder, useLive } = await import("./store.ts");

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
  markUnread(id, "a");
  markUnread(id, "c");
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

test("a hidden pull request whose link changes keeps the new link and stays hidden", () => {
  const id = createFolder("p", "pullRequests", []);
  applyFetch(id, stacked, {});
  hideItems(id, [stacked[2]]);
  const renamed = { ...stacked[2], url: "https://github.com/o/renamed/pull/3" };
  applyFetch(id, [stacked[0], stacked[1], renamed], {});
  assert.deepEqual(live().hidden[id].map((it) => it.url), ["https://github.com/o/renamed/pull/3"]);
  assert.deepEqual(live().items[id].map((it) => it.id), ["a", "b"]);
  const before = live().hidden;
  applyFetch(id, [stacked[0], stacked[1]], {});
  assert.equal(live().hidden, before, "a fetch that changes nothing hidden keeps the hidden list as it was");
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

test("removing a folder forgets its Show More choices and the stacks only it showed", () => {
  const id = createFolder("default", "pullRequests");
  const other = createFolder("default", "pullRequests");
  const inStack = (itemId, n, stack) => ({ ...pr(itemId, n, `h${n}`, "main"), pr: { ...pr(itemId, n, `h${n}`, "main").pr, stack: { id: stack, position: 1, size: 2 } } });
  applyFetch(id, [inStack("x1", 11, "mine"), inStack("x2", 12, "shared")], {});
  applyFetch(other, [inStack("x3", 13, "shared")], {});
  showAllIn(id, "authored");
  showAllIn(other, "authored");
  toggleStack("mine");
  toggleStack("shared");
  removeFolder(id);
  assert.deepEqual(Object.keys(live().showAll), [`${other}:authored`]);
  assert.deepEqual(Object.keys(live().expandedStacks), ["shared"]);
});

const inRepo = (id, repo, source = "bitbucket") => ({ ...pr(id, 1, `h-${id}`, "main"), source, pr: { ...pr(id, 1, `h-${id}`, "main").pr, repo } });

test("a hidden repo stays out through fetches and manual refreshes, keeps its open tabs out of the folder, and comes back read", async () => {
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  const work = inRepo("w", "acme/app");
  const personal = inRepo("m", "me/dotfiles");
  const { fetch, resolveGone } = SOURCES.bitbucket;
  const asked = [];
  SOURCES.bitbucket.fetch = async () => [work, personal];
  SOURCES.bitbucket.resolveGone = async (items) => (asked.push(...items.map((it) => it.id)), {});
  try {
    await refreshFolder(id);
    setRepoHidden(id, "bitbucket:me/dotfiles", true);
    const shown = () => live().items[id].map((it) => it.id).sort();
    assert.deepEqual(shown(), ["w"]);
    await refreshFolder(id);
    await manualRefresh(id);
    assert.deepEqual(shown(), ["w"]);
    assert.deepEqual(asked, [], "a hidden repo's pull requests aren't checked for closing, so they never play a completion");
    const tabPlace = (itemId) => liveTabPlace(itemId, new Set(shown()), new Set([...(live().hidden[id] ?? []), ...live().repoHidden[id]].map((it) => it.id)));
    assert.equal(tabPlace("m"), "hidden");

    setRepoHidden(id, "bitbucket:me/dotfiles", false);
    SOURCES.bitbucket.fetch = async () => Promise.reject(new Error("offline"));
    await refreshFolder(id);
    assert.equal(tabPlace("m"), "hidden", "while the fetch that would bring it back fails, its open tab still has no stray row");
    SOURCES.bitbucket.fetch = async () => [work, personal];
    await refreshFolder(id);
    assert.deepEqual(shown(), ["m", "w"]);
    assert.deepEqual(live().unread[id], []);
  } finally {
    Object.assign(SOURCES.bitbucket, { fetch, resolveGone });
  }
});

test("hiding a repo on one service keeps the same-named repo on the other", () => {
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  applyFetch(id, [inRepo("g", "acme/app", "github"), inRepo("b", "acme/app")], {});
  setRepoHidden(id, "bitbucket:acme/app", true);
  assert.deepEqual(live().items[id].map((it) => it.id), ["g"]);
});

test("hiding a repo also keeps aside its completed pull requests, so their open tabs get no stray row", () => {
  const id = createFolder("p", "pullRequests", []);
  const merged = inRepo("x", "me/dotfiles");
  applyFetch(id, [merged], {});
  applyFetch(id, [], { x: "merged" });
  finishCompleting(id, ["x"]);
  setRepoHidden(id, "bitbucket:me/dotfiles", true);
  assert.deepEqual(live().completed[id], []);
  assert.deepEqual(live().repoHidden[id].map((it) => it.id), ["x"]);
});

test("a pull request hidden until refresh stays hidden when its repo is hidden and shown again, and a manual refresh doesn't show a hidden repo's", async () => {
  const id = createFolder("p", "pullRequests", []);
  const parked = inRepo("p1", "me/dotfiles");
  const other = inRepo("p2", "me/dotfiles");
  applyFetch(id, [parked, other], {});
  hideItems(id, [parked]);
  setRepoHidden(id, "bitbucket:me/dotfiles", true);
  setRepoHidden(id, "bitbucket:me/dotfiles", false);
  applyFetch(id, [parked, other], {});
  assert.deepEqual(live().items[id].map((it) => it.id), ["p2"]);

  setRepoHidden(id, "bitbucket:me/dotfiles", true);
  await manualRefresh(id);
  assert.deepEqual(live().items[id], []);
});

const repoMenu = (id) => {
  const submenu = liveFolderMenuItems("no-window", id).find((it) => it.id === "repos");
  return {
    enabled: submenu.enabled,
    rows: submenu.children.map((it) => (it.separator ? "---" : `${it.checked === false ? "[ ]" : it.checked ? "[x]" : ""}${it.title}${it.enabled === false ? " (off)" : ""}`)),
  };
};

test("the Repositories submenu lists every repo the folder knows, sorted, and names the service only when the folder has two", () => {
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  assert.deepEqual(repoMenu(id), { enabled: false, rows: ["Show All Repositories (off)"] });
  applyFetch(id, [inRepo("a", "zed/app"), inRepo("b", "acme/app"), inRepo("c", "me/parked")], {});
  assert.deepEqual(repoMenu(id).rows, ["Show All Repositories (off)", "---", "[x]acme/app", "[x]me/parked", "[x]zed/app"]);
  hideItems(id, [inRepo("c", "me/parked")]);
  setRepoHidden(id, "bitbucket:zed/app", true);
  applyFetch(id, [inRepo("b", "acme/app"), inRepo("g", "acme/app", "github")], {});
  assert.deepEqual(repoMenu(id), {
    enabled: true,
    rows: ["Show All Repositories", "---", "[x]acme/app (Bitbucket)", "[x]acme/app (GitHub)", "[x]me/parked (Bitbucket)", "[ ]zed/app (Bitbucket)"],
  });
});

test("a shown repo whose service left the folder lets its kept-aside pull requests go, so their open tabs aren't hidden for good", async () => {
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  const { fetch } = SOURCES.github;
  SOURCES.github.fetch = async () => [];
  try {
    applyFetch(id, [inRepo("m", "me/dotfiles")], {});
    setRepoHidden(id, "bitbucket:me/dotfiles", true);
    updateFolder(id, { sources: ["github"] });
    setRepoHidden(id, "bitbucket:me/dotfiles", false);
    await refreshFolder(id);
    assert.deepEqual(live().repoHidden[id], []);
  } finally {
    SOURCES.github.fetch = fetch;
  }
});

test("once its service leaves the folder, only a repo still hidden keeps its pull requests aside", async () => {
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  const { fetch } = SOURCES.github;
  SOURCES.github.fetch = async () => [];
  try {
    applyFetch(id, [inRepo("m", "me/dotfiles"), inRepo("w", "acme/app")], {});
    setRepoHidden(id, "bitbucket:me/dotfiles", true);
    setRepoHidden(id, "bitbucket:acme/app", true);
    setRepoHidden(id, "bitbucket:acme/app", false);
    updateFolder(id, { sources: ["github"] });
    await refreshFolder(id);
    assert.deepEqual(live().repoHidden[id].map((it) => it.id), ["m"]);
  } finally {
    SOURCES.github.fetch = fetch;
  }
});

test("removing a folder keeps the open state of a stack another folder holds in a hidden repo", () => {
  const id = createFolder("default", "pullRequests");
  const other = createFolder("default", "pullRequests");
  const inStack = { ...pr("s1", 21, "h21", "main"), pr: { ...pr("s1", 21, "h21", "main").pr, repo: "me/stacked", stack: { id: "kept-stack", position: 1, size: 2 } } };
  applyFetch(id, [inStack], {});
  applyFetch(other, [inStack], {});
  setRepoHidden(other, "github:me/stacked", true);
  toggleStack("kept-stack");
  removeFolder(id);
  assert.ok("kept-stack" in live().expandedStacks);
});

test("a hidden repo's pull requests come back read when it's shown, even after the folder forgot seeing them", () => {
  const id = createFolder("p", "pullRequests", ["github"]);
  const other = { ...pr("x", 9, "nine", "main"), pr: { ...pr("x", 9, "nine", "main").pr, repo: "o/other" } };
  applyFetch(id, [stacked[2], other], {});
  setRepoHidden(id, "github:o/r", true);
  useLive.setState((s) => ({ known: { ...s.known, [id]: s.known[id].filter((k) => k !== "c") } }));
  setRepoHidden(id, "github:o/r", false);
  applyFetch(id, [stacked[2], other], {});
  assert.deepEqual(live().items[id].map((it) => it.id).sort(), ["c", "x"]);
  assert.deepEqual(live().unread[id], [], "c was in the folder before its repo was hidden, so it isn't new");
});
