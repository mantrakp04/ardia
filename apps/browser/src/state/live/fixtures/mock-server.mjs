import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9411);
const dir = new URL(".", import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

let github;
let prs;
let state;
let approved;
let detailsError;
let bitbucketState;
let gitea;
let giteaExpiresIn;
let giteaMaxItems;
const log = [];
function reset() {
  github = load("github.json");
  prs = new Map([...github.data.authored.nodes, ...github.data.review.nodes].map((n) => [n.id, n]));
  state = {};
  approved = false;
  detailsError = null;
  bitbucketState = "OPEN";
  gitea = load("gitea.json");
  giteaExpiresIn = 3600;
  giteaMaxItems = 50;
}
reset();

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const sendPage = (res, url, items, wrap = (page) => page) => {
  const limit = Math.min(Number(url.searchParams.get("limit")) || giteaMaxItems, giteaMaxItems);
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1);
  res.writeHead(200, { "Content-Type": "application/json", "X-Total-Count": String(items.length) });
  res.end(JSON.stringify(wrap(items.slice((page - 1) * limit, page * limit))));
};
const bodyOf = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => resolve(data));
});
const nodes = (key) => github.data[key].nodes;
const drop = (id) => {
  for (const key of ["authored", "review", "direct"]) github.data[key].nodes = nodes(key).filter((n) => n.id !== id);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const auth = req.headers.authorization ?? "";
  const body = await bodyOf(req);
  log.push(`${req.method} ${url.pathname}`);
  const p = url.pathname;

  if (p === "/mock/reset") return reset(), send(res, 200, { ok: true });
  if (p === "/mock/log") return send(res, 200, log.slice(-100));
  if (p === "/mock/merge" || p === "/mock/close") {
    const id = url.searchParams.get("id");
    drop(id);
    state[id] = p === "/mock/merge" ? "MERGED" : "CLOSED";
    return send(res, 200, { ok: true });
  }
  if (p === "/mock/gitea") {
    const key = url.searchParams.get("key");
    const to = url.searchParams.get("state");
    const listed = (issue) => `${issue.repository.full_name}#${issue.number}` !== key;
    gitea.authored = gitea.authored.filter(listed);
    gitea.review = gitea.review.filter(listed);
    if (to === "merged") Object.assign(gitea.pulls[key], { state: "closed", merged: true });
    if (to === "closed") Object.assign(gitea.pulls[key], { state: "closed" });
    return send(res, 200, { ok: true });
  }
  if (p === "/mock/gitea-page-size") return (giteaMaxItems = Number(url.searchParams.get("size") ?? 50)), send(res, 200, { ok: true });
  if (p === "/mock/gitea-expires") return (giteaExpiresIn = Number(url.searchParams.get("seconds") ?? 3600)), send(res, 200, { ok: true });
  if (p === "/mock/bitbucket-merge") return (bitbucketState = "MERGED"), send(res, 200, { ok: true });
  if (p === "/mock/review") {
    const id = url.searchParams.get("id");
    drop(id);
    state[id] = "OPEN";
    return send(res, 200, { ok: true });
  }
  if (p === "/mock/add") {
    const template = structuredClone(nodes("review")[0] ?? load("github.json").data.review.nodes[0]);
    const n = 500 + nodes("review").length;
    Object.assign(template, { id: `PR_${n}`, number: n, title: `New review request #${n}`, url: `https://github.com/acme/browser/pull/${n}`, updatedAt: new Date().toISOString() });
    github.data.review.nodes.unshift(template);
    prs.set(template.id, template);
    github.data.direct.nodes.push({ id: template.id });
    return send(res, 200, { ok: true, id: template.id });
  }

  if (p === "/mock/details-error") {
    const id = url.searchParams.get("id");
    detailsError = id ? { id, type: url.searchParams.get("type") ?? "OTHER" } : null;
    return send(res, 200, { ok: true, detailsError });
  }

  if (p === "/github/login/device/code") return send(res, 200, { device_code: "mock-device", user_code: "WDJB-MJHT", verification_uri: `http://127.0.0.1:${port}/github/login/device`, expires_in: 900, interval: 1 });
  if (p === "/github/login/device") {
    if (url.searchParams.get("approve")) approved = true;
    return send(res, 200, `<!doctype html><title>Device Activation</title><body style="font:15px -apple-system;padding:40px"><h2>Mock GitHub device activation</h2><p>Code WDJB-MJHT</p>${approved ? "<p id=done>Authorized. You can close this tab.</p>" : `<a id=approve href="?approve=1">Authorize Ardia</a>`}</body>`, "text/html");
  }
  if (p === "/github/login/oauth/access_token") return send(res, 200, approved ? { access_token: "mock-token", token_type: "bearer" } : { error: "authorization_pending" });
  if (p === "/github/graphql") {
    if (auth !== "Bearer mock-token") return send(res, 401, { message: "Bad credentials" });
    const { query, variables } = JSON.parse(body || "{}");
    if (query.includes("LiveFolderDetails")) {
      const i = detailsError ? variables.ids.indexOf(detailsError.id) : -1;
      if (i >= 0 && detailsError.type === "PAGE") return send(res, 502, { message: "Server Error" });
      const details = variables.ids.map((id) => (prs.has(id) ? { ...prs.get(id), state: state[id] ?? "OPEN" } : null));
      if (i < 0) return send(res, 200, { data: { nodes: details } });
      const field = detailsError.type === "FIELD";
      if (field) details[i] = { ...details[i], commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };
      else details[i] = null;
      const path = field ? ["nodes", i, "commits", "nodes", 0, "commit", "statusCheckRollup"] : ["nodes", i];
      const error = { type: field ? "FORBIDDEN" : detailsError.type, path, message: `Mock ${detailsError.type} for ${detailsError.id}` };
      return send(res, 200, { data: { nodes: details }, errors: [error] });
    }
    if (query.includes("LiveFolderGone")) return send(res, 200, { data: { nodes: variables.ids.map((id) => ({ id, state: state[id] ?? "OPEN" })) } });
    if (!query.includes("search(")) return send(res, 200, { data: { viewer: github.data.viewer } });
    return send(res, 200, github);
  }

  if (p.startsWith("/notion/")) {
    if (auth !== "Bearer mock-notion") return send(res, 401, { object: "error", code: "unauthorized" });
    if (p === "/notion/v1/users/me") return send(res, 200, load("notion-me.json"));
    if (p === "/notion/v1/users") return send(res, 200, load("notion-users.json"));
    if (p === "/notion/v1/search") return send(res, 200, load("notion-search.json"));
  }

  if (p.startsWith("/confluence/")) {
    if (!auth.startsWith("Basic ")) return send(res, 401, {});
    if (p === "/confluence/wiki/rest/api/user/current") return send(res, 200, { accountId: "acc-1", displayName: "Octo Dev" });
    if (p === "/confluence/wiki/rest/api/content/search") return send(res, 200, load("confluence-search.json"));
  }

  if (p.startsWith("/bitbucket/")) {
    if (!auth.startsWith("Basic ")) return send(res, 401, {});
    if (p === "/bitbucket/2.0/user") return send(res, 200, { account_id: "bb-1", display_name: "Octo Dev" });
    if (p === "/bitbucket/2.0/repositories/acme/pipelines/pullrequests/7") return send(res, 200, { id: 7, state: bitbucketState });
    if (p.startsWith("/bitbucket/2.0/pullrequests/")) {
      if (bitbucketState !== "OPEN") return send(res, 200, { values: [] });
      return send(res, 200, { values: [{ id: 7, title: "Bitbucket: tidy pipelines", updated_on: "2026-09-25T06:00:00Z", comment_count: 2, author: { display_name: "Octo Dev" }, source: { branch: { name: "tidy" } }, destination: { branch: { name: "main" }, repository: { full_name: "acme/pipelines" } }, links: { html: { href: "https://bitbucket.org/acme/pipelines/pull-requests/7" } }, participants: [{ role: "REVIEWER", state: "approved" }] }] });
    }
    if (p.endsWith("/statuses")) return send(res, 200, { values: [{ state: "SUCCESSFUL", name: "Pipeline #12", url: "https://bitbucket.org/acme/pipelines/pipelines/12" }] });
  }

  if (p === "/gitea/login/oauth/authorize") {
    const challenge = url.searchParams.get("code_challenge");
    if (url.searchParams.get("code_challenge_method") !== "S256") return send(res, 400, "Mock Gitea takes only S256 code challenges", "text/plain");
    const redirect = `${url.searchParams.get("redirect_uri")}?code=${encodeURIComponent(`mock-gitea-code:${challenge}`)}&state=${encodeURIComponent(url.searchParams.get("state"))}`;
    return send(res, 200, `<!doctype html><title>Authorize Application - Gitea</title><body style="font:15px -apple-system;padding:40px"><h2>Mock Gitea authorization</h2><p>Scopes: ${url.searchParams.get("scope")}</p><a id=allow href="${redirect}">Authorize Application</a></body>`, "text/html");
  }
  if (p === "/gitea/login/oauth/access_token") {
    const fields = new URLSearchParams(body);
    const grant = fields.get("grant_type");
    const ok = grant === "refresh_token" ? fields.get("refresh_token")?.startsWith("mock-gitea-refresh") : fields.get("code") === `mock-gitea-code:${createHash("sha256").update(fields.get("code_verifier") ?? "").digest("base64url")}`;
    if (!ok) return send(res, 400, { error: "invalid_grant", error_description: "Mock Gitea refused the grant" });
    const n = log.filter((line) => line === "POST /gitea/login/oauth/access_token").length;
    return send(res, 200, { access_token: `mock-gitea-access-${n}`, refresh_token: `mock-gitea-refresh-${n}`, token_type: "bearer", expires_in: giteaExpiresIn });
  }
  if (p.startsWith("/gitea/api/v1/")) {
    if (auth !== "Bearer mock-gitea" && !auth.startsWith("Bearer mock-gitea-access-")) return send(res, 401, { message: "unauthorized" });
    const api = p.slice("/gitea/api/v1".length);
    if (api === "/user") return send(res, 200, gitea.user);
    if (api === "/repos/search") return send(res, 200, { ok: true, data: [] });
    if (api === "/repos/issues/search") {
      if (url.searchParams.get("created") === "true") return sendPage(res, url, gitea.authored);
      if (url.searchParams.get("review_requested") === "true") return sendPage(res, url, gitea.review);
      return send(res, 200, []);
    }
    const branch = api.match(/^\/repos\/([^/]+\/[^/]+)\/branches\/(.+)$/);
    if (branch) return send(res, 200, gitea.branches[`${branch[1]}:${decodeURIComponent(branch[2])}`] ?? { name: decodeURIComponent(branch[2]), protected: false, required_approvals: 0 });
    const status = api.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/status$/);
    if (status) return sendPage(res, url, gitea.statuses[status[1]]?.statuses ?? [], (statuses) => ({ statuses }));
    const pull = api.match(/^\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)(\/reviews)?$/);
    const key = pull && `${pull[1]}#${pull[2]}`;
    if (key && gitea.pulls[key]) return pull[3] ? sendPage(res, url, gitea.reviews[key] ?? []) : send(res, 200, gitea.pulls[key]);
  }

  if (p === "/google/auth") {
    const redirect = `${url.searchParams.get("redirect_uri")}?code=mock-google-code&state=${encodeURIComponent(url.searchParams.get("state"))}`;
    return send(res, 200, `<!doctype html><title>Sign in - Google Accounts</title><body style="font:15px -apple-system;padding:40px"><h2>Mock Google consent</h2><a id=allow href="${redirect}">Allow</a></body>`, "text/html");
  }
  if (p === "/google/token") return send(res, 200, { access_token: "mock-google-access", refresh_token: "mock-google-refresh", expires_in: 3600 });
  if (p === "/google/drive/v3/about") return send(res, 200, { user: { displayName: "Octo Dev", emailAddress: "octo@acme.com" } });
  if (p === "/google/drive/v3/files") return auth === "Bearer mock-google-access" ? send(res, 200, load("drive-files.json")) : send(res, 401, {});

  send(res, 404, { message: `No fixture for ${req.method} ${p}` });
}).listen(port, "127.0.0.1", () => console.log(`live mock on http://127.0.0.1:${port}`));
