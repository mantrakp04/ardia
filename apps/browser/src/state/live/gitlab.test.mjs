import assert from "node:assert/strict";
import { test } from "node:test";
import { itemId, mapGitlab, mergeableFrom, mergeRequestsQuery, normalizeGitlabSite, parseChangesCount, pipelineChecks, reviewFromApprovals, stopsApprovalProbe } from "./gitlab.ts";
import { LiveError } from "./types.ts";

const fixture = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("./fixtures/gitlab.json", import.meta.url), "utf8")));
const byIid = (iid) => [...fixture.authored, ...fixture.review].find((mr) => mr.iid === iid);
const items = () => mapGitlab(fixture.authored, fixture.review, fixture.approvals);
const item = (iid) => items().find((it) => it.id === itemId(byIid(iid)));

test("a pipeline becomes one check with its status mapped", () => {
  const states = { success: "success", failed: "failure", canceled: "failure", skipped: "neutral", manual: "neutral", running: "pending", blocked: "pending", created: "queued", preparing: "queued", scheduled: "queued" };
  for (const [status, state] of Object.entries(states)) {
    const checks = pipelineChecks({ ...byIid(41), head_pipeline: { id: 9, status, web_url: "https://gitlab.com/p/9" } });
    assert.deepEqual(checks, [{ name: "Pipeline #9", state, url: "https://gitlab.com/p/9" }]);
  }
});

test("a merge request without a pipeline has no checks", () => {
  assert.deepEqual(pipelineChecks(byIid(43)), []);
  assert.deepEqual(item(43).pr.checks, []);
});

test("approvals become the review state, and an absent approvals API is no state", () => {
  assert.equal(reviewFromApprovals({ approvals_required: 1, approvals_left: 0 }), "approved");
  assert.equal(reviewFromApprovals({ approvals_required: 2, approvals_left: 1 }), "required");
  assert.equal(reviewFromApprovals({ approvals_required: 0, approvals_left: 0 }), null);
  assert.equal(reviewFromApprovals(null), null);
  assert.equal(reviewFromApprovals(undefined), null);
  assert.equal(item(43).pr.review, "approved");
  assert.equal(item(77).pr.review, "required");
  assert.equal(item(42).pr.review, null);
});

test("conflicts and merge status map to mergeable", () => {
  assert.equal(mergeableFrom(byIid(42)), "conflicting");
  assert.equal(mergeableFrom(byIid(41)), "mergeable");
  assert.equal(mergeableFrom(byIid(43)), "unknown");
});

test("counts survive GitLab's strings, and the subtitle names the project and iid", () => {
  assert.equal(parseChangesCount("3"), 3);
  assert.equal(parseChangesCount("1000+"), 1000);
  assert.equal(parseChangesCount(null), 0);
  const tidy = item(41);
  assert.equal(tidy.subtitle, "acme/browser !41");
  assert.equal(tidy.pr.changedFiles, 12);
  assert.equal(tidy.pr.comments, 3);
  assert.equal(tidy.pr.draft, false);
  assert.equal(tidy.pr.number, 41);
  assert.equal(tidy.pr.repo, "acme/browser");
  assert.equal(tidy.pr.author, "octo");
  assert.equal(tidy.url, "https://gitlab.com/acme/browser/-/merge_requests/41");
});

test("scope filters pick the section and an MR in both lists appears once, as authored", () => {
  const all = items();
  assert.equal(all.filter((it) => it.pr.number === 41).length, 1);
  assert.equal(all.find((it) => it.pr.number === 41).section, "authored");
  assert.equal(all.find((it) => it.pr.number === 77).section, "review");
  assert.deepEqual(mapGitlab(fixture.authored, fixture.review, fixture.approvals).map((it) => it.pr.number), [41, 42, 43, 77]);
  assert.deepEqual(mapGitlab([], fixture.review, fixture.approvals).map((it) => it.pr.number), [77, 41]);
  assert.deepEqual(mapGitlab(fixture.authored, [], fixture.approvals).map((it) => it.pr.number), [41, 42, 43]);
});

test("a chain of merge requests becomes one stack", () => {
  const stacks = items().filter((it) => it.pr.stack).map((it) => [it.pr.number, it.pr.stack.position, it.pr.stack.size]);
  assert.deepEqual(stacks, [[41, 1, 3], [42, 2, 3], [43, 3, 3]]);
});

test("a site URL is normalized to what the API base needs", () => {
  assert.equal(normalizeGitlabSite("gitlab.molops.io"), "https://gitlab.molops.io");
  assert.equal(normalizeGitlabSite("https://gitlab.molops.io/"), "https://gitlab.molops.io");
  assert.equal(normalizeGitlabSite(" https://gitlab.com/api/v4/ "), "https://gitlab.com");
  assert.equal(normalizeGitlabSite("http://gitlab.internal:8080/gitlab/"), "http://gitlab.internal:8080/gitlab");
  assert.equal(normalizeGitlabSite(""), "https://gitlab.com");
});

test("the list query asks for open merge requests, newest first, a page at a time", () => {
  assert.equal(mergeRequestsQuery("created_by_me"), "scope=created_by_me&state=opened&per_page=100&order_by=updated_at&sort=desc");
  assert.equal(mergeRequestsQuery("all&reviewer_id=31"), "scope=all&reviewer_id=31&state=opened&per_page=100&order_by=updated_at&sort=desc");
});

test("a 403 or 404 from the approvals API stops the probe; anything else does not", () => {
  assert.equal(stopsApprovalProbe(new LiveError("signedOut", "no", 403)), true);
  assert.equal(stopsApprovalProbe(new LiveError("other", "gone", 404)), true);
  assert.equal(stopsApprovalProbe(new LiveError("rateLimited", "slow", 429)), false);
  assert.equal(stopsApprovalProbe(new Error("boom")), false);
  assert.equal(stopsApprovalProbe(null), false);
});
