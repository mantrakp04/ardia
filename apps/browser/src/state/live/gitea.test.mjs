import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { giteaCompletion, giteaLink, giteaPages, giteaRefs, giteaReview, mapGitea } from "./gitea.ts";
import { httpsSiteUrl } from "./net.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/gitea.json", import.meta.url), "utf8"));
const SITE = "https://gitea.example.com";
const details = () =>
  giteaRefs(fixture.authored, fixture.review).map((ref) => {
    const key = `${ref.repo}#${ref.number}`;
    const pull = fixture.pulls[key];
    const branch = fixture.branches[`${ref.repo}:${pull.base.ref}`];
    return { ...ref, pull, reviews: fixture.reviews[key] ?? [], status: fixture.statuses[pull.head.sha] ?? null, requiredApprovals: branch ? branch.required_approvals : 0 };
  });
const byId = (items) => Object.fromEntries(items.map((it) => [it.id, it]));

test("authored pull requests come first, and one listed twice keeps its first section", () => {
  const refs = giteaRefs(fixture.authored, [...fixture.review, fixture.authored[0]]);
  assert.deepEqual(
    refs.map((r) => `${r.section}:${r.repo}#${r.number}`),
    ["authored:acme/forge#12", "authored:acme/forge#13", "review:acme/forge#40", "review:acme/infra#7"],
  );
});

test("a review request for you is a review; one for your team is a team review", () => {
  const items = byId(mapGitea(SITE, "octo-dev", details()));
  assert.equal(items["gitea:acme/forge#12"].section, "authored");
  assert.equal(items["gitea:acme/forge#40"].section, "review");
  assert.equal(items["gitea:acme/infra#7"].section, "team");
});

test("pull request details map as GitHub's do", () => {
  const items = byId(mapGitea(SITE, "octo-dev", details()));
  const pr = items["gitea:acme/forge#40"];
  assert.equal(pr.url, "https://gitea.example.com/acme/forge/pulls/40");
  assert.equal(pr.subtitle, "acme/forge #40");
  assert.equal(pr.source, "gitea");
  assert.deepEqual(
    { author: pr.pr.author, mergeable: pr.pr.mergeable, review: pr.pr.review, comments: pr.pr.comments, additions: pr.pr.additions, deletions: pr.pr.deletions, changedFiles: pr.pr.changedFiles },
    { author: "mona", mergeable: "conflicting", review: "required", comments: 5, additions: 230, deletions: 180, changedFiles: 14 },
  );
  assert.deepEqual(pr.pr.checks, [
    { name: "ci / build (pull_request)", state: "failure", url: "https://ci.example.com/build/88" },
    { name: "ci / lint (pull_request)", state: "neutral", url: null },
  ]);
});

test("Gitea Actions links are made absolute against the server", () => {
  const items = byId(mapGitea(SITE, "octo-dev", details()));
  assert.equal(items["gitea:acme/forge#12"].pr.checks[0].url, "https://gitea.example.com/acme/forge/actions/runs/31/jobs/0");
  assert.equal(giteaLink("https://example.com/git", "/git/acme/forge/actions/runs/1"), "https://example.com/git/acme/forge/actions/runs/1");
  assert.equal(giteaLink("https://example.com/git", "acme/forge"), "https://example.com/git/acme/forge");
  assert.equal(giteaLink(SITE, "https://ci.example.com/1"), "https://ci.example.com/1");
  assert.equal(giteaLink(SITE, ""), null);
});

test("a draft's conflicts are unknown, since Gitea never reports drafts as mergeable", () => {
  const items = byId(mapGitea(SITE, "octo-dev", details()));
  const draft = items["gitea:acme/forge#13"].pr;
  assert.equal(draft.draft, true);
  assert.equal(draft.mergeable, "unknown");
  assert.equal(items["gitea:acme/forge#12"].pr.mergeable, "mergeable");
  const old = { ...fixture.pulls["acme/forge#13"], draft: undefined, mergeable: undefined };
  const [legacy] = mapGitea(SITE, "octo-dev", [{ repo: "acme/forge", number: 13, section: "authored", pull: old, reviews: null, status: null, requiredApprovals: null }]);
  assert.equal(legacy.pr.draft, true, "older servers mark drafts with a WIP: title");
  assert.equal(legacy.pr.mergeable, "unknown");
});

test("each reviewer's latest decision counts, and changes requested wins", () => {
  const pull = fixture.pulls["acme/forge#12"];
  assert.equal(giteaReview(pull, fixture.reviews["acme/forge#12"], 0), "approved");
  assert.equal(giteaReview(pull, [...fixture.reviews["acme/forge#12"]].reverse(), 0), "approved", "order follows review ids");
  assert.equal(giteaReview(fixture.pulls["acme/infra#7"], fixture.reviews["acme/infra#7"], 0), "changesRequested");
  assert.equal(giteaReview(pull, [{ id: 1, state: "REQUEST_CHANGES", dismissed: true, user: { id: 2, login: "mona" } }], 0), null, "a dismissed review doesn't count");
  assert.equal(giteaReview(fixture.pulls["acme/forge#40"], null, 0), "required");
});

test("with required approvals on the base branch, a pull request is approved only once enough official approvals are in", () => {
  const pull = fixture.pulls["acme/forge#12"];
  const approval = (id, user, extra = {}) => ({ id, state: "APPROVED", official: true, dismissed: false, user: { id: user, login: `u${user}` }, ...extra });
  assert.equal(giteaReview(pull, [approval(1, 2)], 2), "required", "1 of 2 official approvals");
  assert.equal(giteaReview(pull, [approval(1, 2), approval(2, 3)], 2), "approved", "2 of 2");
  assert.equal(giteaReview(pull, [approval(1, 2), approval(2, 3, { official: false })], 2), "required", "an approval from someone who can't approve doesn't count");
  assert.equal(giteaReview(pull, [approval(1, 2), approval(2, 3, { dismissed: true })], 2), "required", "a dismissed approval doesn't count");
  assert.equal(giteaReview(pull, [approval(1, 2), approval(2, 2)], 2), "required", "one reviewer approving twice is one approval");
  assert.equal(giteaReview(pull, [approval(1, 2), approval(2, 3), { id: 3, state: "REQUEST_CHANGES", official: true, user: { id: 4, login: "u4" } }], 2), "changesRequested");
  assert.equal(giteaReview(pull, [approval(1, 2, { official: undefined })], 1), "approved", "older servers without the official flag count every approval");
  assert.equal(giteaReview(pull, [approval(1, 2)], null), "approved", "an unknown branch rule falls back to any approval");
});

test("pull requests based on each other's branches stack", () => {
  const items = byId(mapGitea(SITE, "octo-dev", details()));
  assert.deepEqual(items["gitea:acme/forge#12"].pr.stack, { id: "stack:gitea:acme/forge#12", position: 1, size: 2 });
  assert.deepEqual(items["gitea:acme/forge#13"].pr.stack, { id: "stack:gitea:acme/forge#12", position: 2, size: 2 });
  assert.equal(items["gitea:acme/forge#40"].pr.stack, undefined);
});

test("merged and closed pull requests drop out of a fetch", () => {
  const all = details();
  all[0] = { ...all[0], pull: { ...all[0].pull, state: "closed", merged: true } };
  all[2] = { ...all[2], pull: { ...all[2].pull, state: "closed" } };
  assert.deepEqual(mapGitea(SITE, "octo-dev", all).map((it) => it.id), ["gitea:acme/forge#13", "gitea:acme/infra#7"]);
});

test("a pull request that leaves the folder completes as merged, closed or reviewed", () => {
  assert.equal(giteaCompletion({ state: "closed", merged: true }, "authored"), "merged");
  assert.equal(giteaCompletion({ state: "closed", merged: false }, "review"), "closed");
  assert.equal(giteaCompletion({ state: "open", merged: false }, "review"), "reviewed");
  assert.equal(giteaCompletion({ state: "open", merged: false }, "team"), "reviewed");
  assert.equal(giteaCompletion({ state: "open", merged: false }, "authored"), null);
});

test("a Gitea server gets tokens only over HTTPS, or over plain HTTP on this Mac", () => {
  assert.equal(httpsSiteUrl(" git.example.com/ "), "https://git.example.com");
  assert.equal(httpsSiteUrl("https://example.com/git/"), "https://example.com/git");
  for (const site of ["http://localhost:3000", "http://127.0.0.1:3000/gitea", "http://[::1]:3000", "http://LOCALHOST"]) assert.equal(httpsSiteUrl(site), site.replace(/\/$/, ""));
  for (const site of ["http://git.example.com", "HTTP://git.example.com", "http://192.168.1.10:3000", "http://localhost.example.com", "http://127.0.0.1.example.com", "http://localhost@example.com"]) {
    assert.throws(() => httpsSiteUrl(site), { kind: "notConfigured" }, site);
  }
});

const server = (count, maxItems, { withTotal = true } = {}) => {
  const all = Array.from({ length: count }, (_, i) => i + 1);
  const pages = [];
  const load = async (page) => {
    pages.push(page);
    return { body: all.slice((page - 1) * maxItems, page * maxItems), total: withTotal ? count : null };
  };
  return { all, pages, load };
};

test("every page of a Gitea list is read, even when the server caps pages below what was asked", async () => {
  const capped = server(120, 30);
  assert.deepEqual(await giteaPages(capped.load, (page) => page), capped.all);
  assert.deepEqual(capped.pages, [1, 2, 3, 4]);
  const single = server(12, 50);
  assert.deepEqual(await giteaPages(single.load, (page) => page), single.all);
  assert.deepEqual(single.pages, [1]);
});

test("without a total count, a Gitea list is read until a page comes back empty", async () => {
  const short = server(45, 30, { withTotal: false });
  assert.deepEqual(await giteaPages(short.load, (page) => page), short.all);
  assert.deepEqual(short.pages, [1, 2, 3]);
});

test("a Gitea list stops after twenty pages", async () => {
  const pages = [];
  const items = await giteaPages(async (page) => (pages.push(page), { body: [page], total: null }), (page) => page);
  assert.equal(items.length, 20);
  assert.equal(pages.at(-1), 20);
});
