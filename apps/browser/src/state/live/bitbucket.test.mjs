import assert from "node:assert/strict";
import { test } from "node:test";

const { SOURCES, connectBitbucket } = await import("./sources.ts");
const { errorText } = await import("./engine.ts");

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

const authored = { filters: { authored: true, reviewRequests: false } };
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
  await connectBitbucket("me@example.com", "token");
  for (const [status, kind, text] of [
    [404, "notFound", "Bitbucket doesn't recognize this request. Ardia may need an update."],
    [403, "forbidden", "Your Bitbucket token is missing a permission. Check its scopes in Settings."],
  ]) {
    serve({ [`${API}/user/workspaces?pagelen=100`]: status });
    const error = await SOURCES.bitbucket.fetch(authored).then(
      () => null,
      (e) => e,
    );
    assert.equal(error?.kind, kind);
    assert.equal(errorText(error.kind, "bitbucket"), text);
  }
});
