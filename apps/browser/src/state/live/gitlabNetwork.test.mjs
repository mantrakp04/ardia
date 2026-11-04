import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { endpoints, request } from "./net.ts";
import { LiveError } from "./types.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/gitlab.json", import.meta.url), "utf8"));

test("GitLab uses the API v4 base for a site", () => {
  assert.equal(endpoints.gitlab("https://gitlab.com///"), "https://gitlab.com/api/v4");
});

test("HTTP response errors retain their status", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403, 429, 404]) {
      globalThis.fetch = async () => new Response("rejected", { status });
      await assert.rejects(request("https://gitlab.example/api"), (error) => error instanceof LiveError && error.status === status);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function withGitLabSource(fetchMock, run) {
  const { shellNativeModules } = await import("../../test-native/shell.ts");
  const originalFetch = globalThis.fetch;
  const originalGet = shellNativeModules.ArdiaKeychain.get;
  shellNativeModules.ArdiaKeychain.get = async () => "gitlab-token";
  const { SOURCES } = await import("./sources.ts");
  const { updateConfig } = await import("./store.ts");
  updateConfig({ gitlabSite: "https://gitlab.example", gitlabUserId: "31" });
  globalThis.fetch = fetchMock;
  try {
    await run(SOURCES.gitlab);
  } finally {
    globalThis.fetch = originalFetch;
    shellNativeModules.ArdiaKeychain.get = originalGet;
  }
}

test("missing list details are fetched once after deduping and mapped", async () => {
  const listMr = { ...fixture.authored[0] };
  delete listMr.head_pipeline;
  delete listMr.changes_count;
  const detailCalls = [];
  await withGitLabSource(async (url, init) => {
    const path = String(url);
    assert.equal(init.headers["PRIVATE-TOKEN"], "gitlab-token");
    if (path.includes("/merge_requests?")) return Response.json([listMr]);
    if (path.endsWith("/projects/7/merge_requests/41")) {
      detailCalls.push(path);
      return Response.json(fixture.authored[0]);
    }
    if (path.endsWith("/approvals")) return Response.json(fixture.approvals["7:41"]);
    throw new Error(`Unexpected GitLab URL: ${path}`);
  }, async (source) => {
    const items = await source.fetch({ filters: { authored: true, reviewRequests: true } });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].pr.checks, [{ name: "Pipeline #512", state: "success", url: fixture.authored[0].head_pipeline.web_url }]);
    assert.equal(items[0].pr.changedFiles, 12);
  });
  assert.equal(detailCalls.length, 1);
});

test("a failed detail request keeps its list item and missing checks", async () => {
  const listMr = { ...fixture.authored[0] };
  delete listMr.head_pipeline;
  delete listMr.changes_count;
  const detailCalls = [];
  await withGitLabSource(async (url) => {
    const path = String(url);
    if (path.includes("/merge_requests?")) return Response.json([listMr]);
    if (path.endsWith("/projects/7/merge_requests/41")) {
      detailCalls.push(path);
      return new Response("unavailable", { status: 503 });
    }
    if (path.endsWith("/approvals")) return Response.json(fixture.approvals["7:41"]);
    throw new Error(`Unexpected GitLab URL: ${path}`);
  }, async (source) => {
    const items = await source.fetch({ filters: { authored: true, reviewRequests: false } });
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].pr.checks, []);
  });
  assert.equal(detailCalls.length, 1);
});
