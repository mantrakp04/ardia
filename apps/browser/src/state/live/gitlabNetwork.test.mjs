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

for (const stage of ["detail", "approvals"]) {
  for (const status of [429, 401]) {
    test(`${stage} ${status} stops later batches and reports the error`, async () => {
      const mrs = Array.from({ length: 25 }, (_, i) => {
        const mr = { ...fixture.authored[0], iid: i + 1 };
        if (stage === "detail") delete mr.head_pipeline;
        return mr;
      });
      const calls = [];
      await withGitLabSource(async (url) => {
        const path = String(url);
        if (path.includes("/merge_requests?")) return Response.json(mrs);
        calls.push(path);
        return new Response("rejected", { status });
      }, async (source) => {
        await assert.rejects(source.fetch({ filters: { authored: true, reviewRequests: false } }),
          (error) => error instanceof LiveError && error.kind === (status === 429 ? "rateLimited" : "signedOut") && error.status === status);
      });
      assert.equal(calls.length, 10);
      assert.equal(calls.every((path) => path.endsWith("/approvals") === (stage === "approvals")), true);
    });
  }
}

for (const status of [403, 404]) {
  test(`approvals ${status} stops the probe without failing the folder`, async () => {
    const mrs = Array.from({ length: 25 }, (_, i) => ({ ...fixture.authored[0], iid: i + 1 }));
    let calls = 0;
    await withGitLabSource(async (url) => {
      if (String(url).includes("/merge_requests?")) return Response.json(mrs);
      calls++;
      return new Response("unavailable", { status });
    }, async (source) => {
      const items = await source.fetch({ filters: { authored: true, reviewRequests: false } });
      assert.equal(items.length, 25);
      assert.equal(items.every((item) => item.pr.review === null), true);
    });
    assert.equal(calls, 10);
  });
}

test("an unconfigured review-only folder reports that GitLab must be connected", async () => {
  const { SOURCES } = await import("./sources.ts");
  const { updateConfig, setAccount } = await import("./store.ts");
  updateConfig({ gitlabUserId: "" });
  setAccount("gitlab", null);
  await assert.rejects(SOURCES.gitlab.fetch({ filters: { authored: false, reviewRequests: true } }),
    (error) => error instanceof LiveError && ["notConfigured", "signedOut"].includes(error.kind));
});

test("switching GitLab instances clears only GitLab state and rejects an old refresh", async () => {
  const { shellNativeModules } = await import("../../test-native/shell.ts");
  const { connectGitlab, disconnect } = await import("./sources.ts");
  const { live, useLive, createFolder, updateConfig } = await import("./store.ts");
  const { refreshFolder } = await import("./engine.ts");
  const { mapGitlab } = await import("./gitlab.ts");
  const oldGet = shellNativeModules.ArdiaKeychain.get;
  const originalFetch = globalThis.fetch;
  let release;
  let started;
  const startedPromise = new Promise((resolve) => { started = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  shellNativeModules.ArdiaKeychain.get = async () => "token";
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("/user")) return Response.json(fixture.user);
    if (path.includes("/merge_requests?")) { started(); await held; return Response.json([fixture.authored[0]]); }
    if (path.endsWith("/approvals")) return Response.json(fixture.approvals["7:41"]);
    throw new Error(`Unexpected GitLab URL: ${path}`);
  };
  const id = createFolder("default", "pullRequests", ["gitlab"]);
  const item = mapGitlab([fixture.authored[0]], [], {})[0];
  const other = { ...item, id: "github:1", source: "github" };
  try {
    updateConfig({ gitlabSite: "https://instance-a.example", gitlabUserId: "31" });
    useLive.setState({ items: { [id]: [item, other] }, hidden: { [id]: [item, other] }, repoHidden: { [id]: [item, other] }, completed: { [id]: [{ item, state: "merged", at: 1 }, { item: other, state: "merged", at: 1 }] }, known: { [id]: [item.id, other.id] }, unread: { [id]: [item.id, other.id] }, completing: { [id]: [item.id, other.id] } });
    const refresh = refreshFolder(id);
    await startedPromise;
    await disconnect("gitlab");
    await connectGitlab("https://instance-b.example", "new-token");
    for (const field of ["items", "hidden", "repoHidden"]) assert.deepEqual(live()[field][id].map((it) => it.id), [other.id]);
    assert.deepEqual(live().completed[id].map((c) => c.item.id), [other.id]);
    for (const field of ["known", "unread", "completing"]) assert.deepEqual(live()[field][id], [other.id]);
    release();
    await refresh;
    assert.deepEqual(live().items[id].map((it) => it.id), [other.id]);
    globalThis.fetch = async (url) => String(url).includes("/merge_requests?")
      ? Response.json([{ ...fixture.authored[0], web_url: "https://instance-b.example/mr/41" }])
      : Response.json(fixture.approvals["7:41"]);
    await refreshFolder(id);
    assert.equal(live().items[id].find((it) => it.id === item.id)?.url, "https://instance-b.example/mr/41");
  } finally {
    release();
    globalThis.fetch = originalFetch;
    shellNativeModules.ArdiaKeychain.get = oldGet;
  }
});

test("an old refresh cannot restore items after an instance switch", async () => {
  const { shellNativeModules } = await import("../../test-native/shell.ts");
  const { connectGitlab } = await import("./sources.ts");
  const { live, createFolder, updateConfig } = await import("./store.ts");
  const { refreshFolder } = await import("./engine.ts");
  const oldGet = shellNativeModules.ArdiaKeychain.get;
  const originalFetch = globalThis.fetch;
  let release;
  let started;
  const held = new Promise((resolve) => { release = resolve; });
  const startedPromise = new Promise((resolve) => { started = resolve; });
  shellNativeModules.ArdiaKeychain.get = async () => "token";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/user")) return Response.json(fixture.user);
    if (String(url).includes("/merge_requests?")) { started(); await held; return Response.json([fixture.authored[0]]); }
    return Response.json(fixture.approvals["7:41"]);
  };
  try {
    updateConfig({ gitlabSite: "https://instance-a.example", gitlabUserId: "31" });
    const id = createFolder("default", "pullRequests", ["gitlab"]);
    const refresh = refreshFolder(id);
    await startedPromise;
    await connectGitlab("https://instance-b.example", "token");
    release();
    await refresh;
    assert.deepEqual(live().items[id] ?? [], []);
  } finally {
    release();
    globalThis.fetch = originalFetch;
    shellNativeModules.ArdiaKeychain.get = oldGet;
  }
});
