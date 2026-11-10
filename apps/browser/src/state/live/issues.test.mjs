import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { docs } from "../../test-native/index.ts";

const oldFolder = { id: "old", profileId: "p", kind: "pullRequests", name: "PRs", icon: null, collapsed: false, sources: [], filters: { authored: false, reviewRequests: true }, createdAt: 0 };
docs.set("live.json", JSON.stringify({ folders: { old: oldFolder }, folderOrder: ["old"] }));
const { issueCompletion, issueDetailIds, mapIssues } = await import("./github.ts");
const { refreshFolder } = await import("./engine.ts");
const { SOURCES } = await import("./sources.ts");
const { folderRows, repoKey } = await import("./rows.ts");
const { liveFolderMenuItems, liveItemMenuItems, newLiveFolderMenuItem } = await import("../sidebar/liveMenus.ts");
const { applyFetch, createFolder, hideItems, live, setRepoHidden, updateFolder } = await import("./store.ts");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/github-issues.json", import.meta.url), "utf8"));
const details = [...new Map(Object.values(fixture.data).flatMap((s) => s.nodes).map((n) => [n.id, n])).values()];
const defaults = { authored: true, reviewRequests: true, assigned: true, mentioned: false };
const sections = (items) => items.map((it) => [it.id.slice("github:".length), it.section]);

const issue = (id, repo = "acme/browser", section = "assigned") => ({
  id,
  source: "github",
  url: `https://github.com/${repo}/issues/1`,
  title: id,
  subtitle: `${repo} #1`,
  icon: null,
  updatedAt: 0,
  section,
  issue: { number: 1, repo, labels: [], assignees: [], comments: 0, createdAt: 0 },
});

test("issues map into Assigned and Created by default, each listed once, Mentioned left out", () => {
  const items = mapIssues(fixture, details, defaults);
  assert.deepEqual(sections(items), [
    ["I_201", "assigned"],
    ["I_202", "assigned"],
    ["I_203", "created"],
    ["I_204", "created"],
  ]);
  const first = items[0];
  assert.equal(first.subtitle, "acme/browser #201");
  assert.equal(first.url, "https://github.com/acme/browser/issues/201");
  assert.deepEqual(first.issue.labels, [{ name: "bug", color: "d73a4a" }, { name: "sidebar", color: "0e8a16" }]);
  assert.deepEqual(first.issue.assignees, [{ login: "octo-dev", avatar: "https://avatars.githubusercontent.com/octo-dev" }]);
  assert.equal(first.issue.comments, 4);
  assert.equal(first.issue.createdAt, Date.parse("2026-09-18T08:00:00Z"));
  assert.equal(first.pr, undefined);
});

test("the filters choose the sections, and an issue falls to the next section that lists it", () => {
  assert.deepEqual(issueDetailIds(fixture, defaults), ["I_201", "I_202", "I_203", "I_204"]);
  assert.deepEqual(sections(mapIssues(fixture, details, { ...defaults, assigned: false, mentioned: true })), [
    ["I_202", "created"],
    ["I_203", "created"],
    ["I_204", "created"],
    ["I_205", "mentioned"],
    ["I_201", "mentioned"],
  ]);
  assert.deepEqual(issueDetailIds(fixture, { ...defaults, assigned: false, authored: false }), []);
});

test("an issue that closed between the search and its details drops out", () => {
  const closed = details.map((d) => (d.id === "I_203" ? { ...d, state: "CLOSED", stateReason: "COMPLETED" } : d));
  assert.ok(!mapIssues(fixture, closed, defaults).some((it) => it.id === "github:I_203"));
});

test("a closed issue completes as Completed or Not Planned", () => {
  assert.equal(issueCompletion("CLOSED", "COMPLETED"), "completed");
  assert.equal(issueCompletion("CLOSED", null), "completed");
  assert.equal(issueCompletion("CLOSED", "NOT_PLANNED"), "notPlanned");
  assert.equal(issueCompletion("CLOSED", "DUPLICATE"), "notPlanned");
  assert.equal(issueCompletion("OPEN", null), null);
});

test("an issue folder shows a header for each section", () => {
  const items = mapIssues(fixture, details, { ...defaults, mentioned: true });
  const rows = folderRows({ id: "f", kind: "issues", groupStacks: true }, items, {});
  assert.deepEqual(
    rows.filter((r) => r.kind === "header").map((r) => r.title),
    ["Assigned to Me", "Created by Me", "Mentioned"],
  );
});

test("a new Issues folder fetches GitHub with Assigned and Created on and Mentioned off", () => {
  const id = createFolder("p", "issues");
  const folder = live().folders[id];
  assert.equal(folder.name, "Issues");
  assert.deepEqual(folder.sources, ["github"]);
  assert.deepEqual(folder.filters, defaults);
  assert.ok(newLiveFolderMenuItem().children.some((c) => c.id === "live:issues"));
});

test("a folder saved before issue filters existed keeps its filters and gets the new ones' defaults", () => {
  assert.deepEqual(live().folders.old.filters, { authored: false, reviewRequests: true, assigned: true, mentioned: false });
  assert.equal(live().folders.old.groupStacks, true);
});

const stubGithub = async (fetched, gone, run) => {
  const { fetch, resolveGone } = SOURCES.github;
  const asked = [];
  SOURCES.github.fetch = async () => fetched();
  SOURCES.github.resolveGone = async (items) => (asked.push(...items.map((it) => it.id)), gone);
  try {
    await run();
  } finally {
    Object.assign(SOURCES.github, { fetch, resolveGone });
  }
  return asked;
};

test("a closed issue moves to Completed with its reason, and a hidden one that closes stops counting as hidden", async () => {
  const id = createFolder("p", "issues");
  const [a, b, c] = [issue("a"), issue("b"), issue("c")];
  let listed = [a, b, c];
  await stubGithub(() => listed, { a: "completed", b: "notPlanned" }, async () => {
    await refreshFolder(id);
    hideItems(id, [b]);
    listed = [c];
    await refreshFolder(id);
  });
  assert.deepEqual(live().completed[id].map((done) => [done.item.id, done.state]), [["a", "completed"]]);
  assert.deepEqual(live().hidden[id], []);
});

test("an issue that only drops out of the search, still open, leaves without completing", async () => {
  const id = createFolder("p", "issues");
  let listed = [issue("a"), issue("b")];
  await stubGithub(() => listed, {}, async () => {
    await refreshFolder(id);
    listed = [issue("b")];
    await refreshFolder(id);
  });
  assert.deepEqual(live().items[id].map((it) => it.id), ["b"]);
  assert.deepEqual(live().completed[id] ?? [], []);
});

test("issues in a section whose filter is off aren't asked about", async () => {
  const id = createFolder("p", "issues");
  updateFolder(id, { filters: { ...defaults, mentioned: true } });
  let listed = [issue("m", "acme/browser", "mentioned"), issue("a")];
  const asked = await stubGithub(() => listed, { m: "completed" }, async () => {
    await refreshFolder(id);
    updateFolder(id, { filters: defaults });
    listed = [issue("a")];
    await refreshFolder(id);
  });
  assert.deepEqual(asked, []);
  assert.deepEqual(live().completed[id] ?? [], []);
});

test("Hide Until Refresh keeps an issue out through later fetches", () => {
  const id = createFolder("p", "issues");
  const [a, b] = [issue("a"), issue("b")];
  applyFetch(id, [a, b], {});
  assert.ok(liveItemMenuItems("no-window", id, a, null).some((it) => it.id === "hide"));
  hideItems(id, [a]);
  applyFetch(id, [a, b], {});
  assert.deepEqual(live().items[id].map((it) => it.id), ["b"]);
});

test("hiding an issue's repo keeps its issues out of the folder", () => {
  const id = createFolder("p", "issues");
  const site = issue("s", "acme/site");
  applyFetch(id, [issue("a"), site], {});
  assert.equal(repoKey(site), "github:acme/site");
  setRepoHidden(id, "github:acme/site", true);
  assert.deepEqual(live().items[id].map((it) => it.id), ["a"]);
});

test("the Issues folder menu has its three filters, Repositories and Show Completed, but no stacks", () => {
  const id = createFolder("p", "issues");
  applyFetch(id, [issue("a"), issue("s", "acme/site")], {});
  const items = liveFolderMenuItems("no-window", id).filter((it) => !it.separator);
  const byId = Object.fromEntries(items.map((it) => [it.id, it]));
  assert.deepEqual(
    items.filter((it) => it.id.startsWith("filter:")).map((it) => [it.title, it.checked]),
    [
      ["Assigned to Me", true],
      ["Created by Me", true],
      ["Mentioned", false],
    ],
  );
  assert.equal(byId.repos.enabled, true);
  assert.ok(byId["option:showCompleted"]);
  assert.equal(byId["option:groupStacks"], undefined);
  assert.equal(byId.sources.title, "Issues");
  assert.deepEqual(byId.sources.children.map((c) => c.id), ["source:github"]);
});

test("the Pull Requests folder menu keeps its filters and stacks", () => {
  const id = createFolder("p", "pullRequests");
  const items = liveFolderMenuItems("no-window", id).filter((it) => !it.separator);
  assert.deepEqual(items.filter((it) => it.id.startsWith("filter:")).map((it) => it.title), ["Created by Me", "Awaiting My Review"]);
  assert.ok(items.some((it) => it.id === "option:groupStacks"));
  assert.equal(items.find((it) => it.id === "sources").title, "Pull Requests");
});
