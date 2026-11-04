import assert from "node:assert/strict";
import { test } from "node:test";

const { SOURCES, connectBitbucket } = await import("./sources.ts");
const { errorText, folderErrorText, folderErrorTexts, refreshFolder } = await import("./engine.ts");
const { applyFetch, createFolder, live, useLive } = await import("./store.ts");
const { PartialFetch } = await import("./types.ts");

const API = "https://api.bitbucket.org/2.0";
const ACCOUNT = "712020:abc";
const prJson = (id, repo) => ({
  id,
  title: `PR ${id}`,
  updated_on: "2026-09-25T06:00:00Z",
  comment_count: 0,
  author: { display_name: "Octo Dev" },
  source: { branch: { name: `b${id}` } },
  destination: { branch: { name: "main" }, repository: { full_name: repo } },
  links: { html: { href: `https://bitbucket.org/${repo}/pull-requests/${id}` } },
  participants: [],
});

function serve(routes) {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(url);
    const body = routes[url];
    if (typeof body === "number") return new Response("{}", { status: body });
    if (body) return Response.json(body);
    if (url.endsWith("/statuses?pagelen=50")) return Response.json({ values: [] });
    if (url === `${API}/user`) return Response.json({ account_id: ACCOUNT, display_name: "Octo Dev" });
    return new Response("There is no API hosted at this URL", { status: 404 });
  };
  return asked;
}

const authored = { id: "folder", filters: { authored: true, reviewRequests: false } };
const workspacePRs = (slug) => `${API}/workspaces/${slug}/pullrequests/${encodeURIComponent(ACCOUNT)}?state=OPEN&pagelen=50`;

test("open pull requests come from every workspace the user is in, following each page", async () => {
  const asked = serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }], next: `${API}/user/workspaces?pagelen=100&page=2` },
    [`${API}/user/workspaces?pagelen=100&page=2`]: { values: [{ workspace: { slug: "beta" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")], next: `${workspacePRs("acme")}&page=2` },
    [`${workspacePRs("acme")}&page=2`]: { values: [prJson(2, "acme/api")] },
    [workspacePRs("beta")]: { values: [prJson(3, "beta/app")] },
  });
  await connectBitbucket("me@example.com", "token");
  const items = await SOURCES.bitbucket.fetch(authored);
  assert.deepEqual(items.map((it) => it.id).sort(), ["bitbucket:acme/api#2", "bitbucket:acme/web#1", "bitbucket:beta/app#3"]);
  assert.ok(!asked.some((url) => url.startsWith(`${API}/pullrequests/`)), "the removed cross-workspace route is never called");
});

test("a 404 and a 403 from Bitbucket each get their own message instead of the generic one", async () => {
  for (const [status, kind, text] of [
    [404, "notFound", "Bitbucket doesn't recognize this request. Ardia may need an update."],
    [403, "forbidden", "Your Bitbucket token is missing a permission. Check its scopes in Settings."],
  ]) {
    serve({ [`${API}/user/workspaces?pagelen=100`]: status });
    await connectBitbucket("me@example.com", "token");
    const error = await SOURCES.bitbucket.fetch(authored).then(
      () => null,
      (e) => e,
    );
    assert.equal(error?.kind, kind);
    assert.equal(errorText(error.kind, "bitbucket"), text);
  }
});

const partly = (fetching) =>
  fetching.then(
    () => assert.fail("expected a partial fetch"),
    (e) => (assert.ok(e instanceof PartialFetch, String(e)), e),
  );

test("a workspace that fails doesn't hide the pull requests of the others, and says it failed", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 403,
  });
  await connectBitbucket("me@example.com", "token");
  const partial = await partly(SOURCES.bitbucket.fetch(authored));
  assert.deepEqual(partial.items.map((it) => it.id), ["bitbucket:acme/web#1"]);
  assert.deepEqual(partial.failures.map((f) => f.kind), ["forbidden"]);
});

test("a folder shows the pull requests that loaded and the error of the workspace that didn't", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 403,
  });
  await connectBitbucket("me@example.com", "token");
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  await refreshFolder(id);
  assert.deepEqual(live().items[id].map((it) => it.id), ["bitbucket:acme/web#1"]);
  assert.equal(live().status[id].state, "error");
  assert.deepEqual(live().status[id].errors.map((e) => e.kind), ["forbidden"]);
});

test("a folder shows each kind of error its failing workspaces hit", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }, { workspace: { slug: "busy" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 403,
    [workspacePRs("busy")]: 429,
  });
  await connectBitbucket("me@example.com", "token");
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  await refreshFolder(id);
  assert.deepEqual(live().items[id].map((it) => it.id), ["bitbucket:acme/web#1"]);
  assert.deepEqual(live().status[id].errors.map((e) => e.kind).sort(), ["forbidden", "rateLimited"]);
});

test("when every workspace fails, the folder shows that error", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "beta" } }] },
    [workspacePRs("acme")]: 403,
    [workspacePRs("beta")]: 403,
  });
  await connectBitbucket("me@example.com", "token");
  const error = await SOURCES.bitbucket.fetch(authored).then(
    () => null,
    (e) => e,
  );
  assert.equal(error?.kind, "forbidden");
});

test("a next link that points back to a page already read stops the fetch", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }], next: `${API}/user/workspaces?pagelen=100` },
  });
  await connectBitbucket("me@example.com", "token");
  const error = await SOURCES.bitbucket.fetch(authored).then(
    () => null,
    (e) => e,
  );
  assert.equal(error?.kind, "other");
});

test("a workspace that fails keeps the pull requests the folder already showed from it", async () => {
  const cached = { id: "bitbucket:locked/app#9", source: "bitbucket", url: "https://bitbucket.org/locked/app/pull-requests/9", title: "PR 9", subtitle: "locked/app #9", icon: null, updatedAt: 0, section: "authored", pr: { repo: "locked/app", number: 9 } };
  const elsewhere = { ...cached, id: "bitbucket:acme/old#8", pr: { repo: "acme/old", number: 8 } };
  useLive.setState({ items: { folder: [cached, elsewhere] } });
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 503,
  });
  await connectBitbucket("me@example.com", "token");
  const partial = await partly(SOURCES.bitbucket.fetch(authored));
  useLive.setState({ items: {} });
  assert.deepEqual(partial.items.map((it) => it.id), ["bitbucket:acme/web#1", "bitbucket:locked/app#9"]);
});

test("workspaces and statuses are asked at most ten at a time", async () => {
  const slugs = Array.from({ length: 25 }, (_, i) => `w${i}`);
  const routes = { [`${API}/user/workspaces?pagelen=100`]: { values: slugs.map((slug) => ({ workspace: { slug } })) } };
  for (const slug of slugs) routes[workspacePRs(slug)] = { values: [prJson(1, `${slug}/repo`)] };
  serve(routes);
  await connectBitbucket("me@example.com", "token");
  const stubbed = globalThis.fetch;
  let inFlight = 0;
  let most = 0;
  globalThis.fetch = async (url) => {
    most = Math.max(most, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return stubbed(url).finally(() => inFlight--);
  };
  const items = await SOURCES.bitbucket.fetch(authored);
  assert.equal(items.length, 25);
  assert.equal(most, 10);
});

test("a commit's finished statuses are reused, while running ones and new commits are asked again", async () => {
  const withCommit = (hash) => ({ ...prJson(5, "acme/ci"), source: { branch: { name: "b5" }, commit: { hash } } });
  const statusesOf = `${API}/repositories/acme/ci/pullrequests/5/statuses?pagelen=50`;
  const refresh = async (hash, state) => {
    const asked = serve({
      [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }] },
      [workspacePRs("acme")]: { values: [withCommit(hash)] },
      [statusesOf]: { values: [{ state, name: "build", url: "https://ci.example/1" }] },
    });
    await connectBitbucket("me@example.com", "token");
    const [item] = await SOURCES.bitbucket.fetch(authored);
    return { askedStatuses: asked.includes(statusesOf), check: item.pr.checks[0]?.state };
  };
  assert.deepEqual(await refresh("aaa", "INPROGRESS"), { askedStatuses: true, check: "pending" });
  assert.deepEqual(await refresh("aaa", "SUCCESSFUL"), { askedStatuses: true, check: "success" });
  assert.deepEqual(await refresh("aaa", "FAILED"), { askedStatuses: false, check: "success" });
  assert.deepEqual(await refresh("bbb", "FAILED"), { askedStatuses: true, check: "failure" });
});

test("a refresh keeps a failed workspace's pull requests in the folder", async () => {
  const cached = { id: "bitbucket:locked/app#9", source: "bitbucket", url: "https://bitbucket.org/locked/app/pull-requests/9", title: "PR 9", subtitle: "locked/app #9", icon: null, updatedAt: 0, section: "authored", pr: { repo: "locked/app", number: 9, checks: [] } };
  const id = createFolder("p", "pullRequests", ["bitbucket"]);
  applyFetch(id, [cached], {});
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 503,
  });
  await connectBitbucket("me@example.com", "token");
  await refreshFolder(id);
  assert.deepEqual(live().items[id].map((it) => it.id).sort(), ["bitbucket:acme/web#1", "bitbucket:locked/app#9"]);
  assert.deepEqual(live().status[id].errors.map((e) => e.source), ["bitbucket"]);
});

test("a source that fails outright doesn't hide another source's partial failure", async () => {
  serve({
    [`${API}/user/workspaces?pagelen=100`]: { values: [{ workspace: { slug: "acme" } }, { workspace: { slug: "locked" } }] },
    [workspacePRs("acme")]: { values: [prJson(1, "acme/web")] },
    [workspacePRs("locked")]: 403,
  });
  await connectBitbucket("me@example.com", "token");
  const id = createFolder("p", "pullRequests", ["github", "bitbucket"]);
  await refreshFolder(id);
  const errors = live().status[id].errors;
  assert.deepEqual(errors.map((e) => `${e.source}:${e.kind}`).sort(), ["bitbucket:forbidden", "github:notConfigured"]);
  assert.equal(folderErrorText(errors), "Connect GitHub in Settings · Your Bitbucket token is missing a permission. Check its scopes in Settings.");
  assert.deepEqual(folderErrorTexts([...errors, ...errors]), ["Connect GitHub in Settings", "Your Bitbucket token is missing a permission. Check its scopes in Settings."]);
});
