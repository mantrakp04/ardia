import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hostLiveClient, LIVE_CAPABILITIES } from "../../../apps/linux/src/hostLive.ts";
import { linuxLiveSources } from "../../../apps/linux/src/liveSources.ts";
import { live, setAccount } from "../../../apps/browser/src/state/live/store.ts";
import { LiveError } from "../../../apps/browser/src/state/live/types.ts";

const TOOL = process.env.LIVE_HOST_TOOL;
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/live-contract");
const fixtureToken = (prefix, bytes = 18) => `${prefix}${randomBytes(bytes).toString("hex")}`;
const GENERATED = {
  deviceCode: fixtureToken("", 20),
  githubAccess: fixtureToken("gho_"),
  googleAccess1: fixtureToken("ya29."),
  googleAccess2: fixtureToken("ya29."),
  googleRefresh: fixtureToken("1//"),
};
const withGenerated = (value) =>
  typeof value === "string"
    ? value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
        assert.ok(name in GENERATED, `no generated fixture value ${name}`);
        return GENERATED[name];
      })
    : Array.isArray(value)
      ? value.map(withGenerated)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withGenerated(inner)]))
        : value;
const PROVIDERS = Object.fromEntries(["github", "bitbucket", "notion", "confluence", "google"].map((name) => [name, withGenerated(JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")))]));
const scratch = mkdtempSync(join(tmpdir(), "ardia-live-contract-"));
const keys = join(scratch, "Ardia Live Tokens");
const REDIRECT = "http://127.0.0.1:53682/ardia-oauth";
const CREDENTIALS = {
  github: fixtureToken("ghp_"),
  bitbucketEmail: "emma@acme.example",
  bitbucket: fixtureToken("ATATT3x"),
  notion: fixtureToken("ntn_"),
  confluence: fixtureToken("ATATT3x"),
  googleClient: `${randomBytes(5).toString("hex")}-contract.apps.googleusercontent.com`,
  googleSecret: fixtureToken("GOCSPX-"),
  googleCode: fixtureToken("4/0A"),
  googleVerifier: fixtureToken("", 24),
};

const overrides = new Map();
const requests = [];
let server;
let tool;
let sequence = 0;
const waiting = new Map();

const folder = (kind, sources) => ({ id: `lf-${kind}`, profileId: "default", kind, name: kind, icon: null, collapsed: false, sources, filters: { authored: true, reviewRequests: true }, groupStacks: false, showCompleted: false, createdAt: 0 });
const prFolder = folder("pullRequests", ["github", "bitbucket"]);
const docFolder = folder("documents", ["notion", "confluence", "gdrive"]);

function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`${method} timed out`));
    }, 20_000);
    waiting.set(id, (reply) => {
      clearTimeout(timer);
      if (reply.ok) resolve(reply.value);
      else reject(Object.assign(new Error(reply.message), { code: reply.code }));
    });
    tool.stdin.write(`${JSON.stringify({ id, method, args })}\n`);
  });
}

const host = { bootstrap: { windowId: "w1", profileId: "default", capabilities: [...LIVE_CAPABILITIES] }, invoke: (method, { args }) => call(method, args) };
const client = hostLiveClient(host, (source) => !!live().accounts[source]);
const linux = linuxLiveSources(client);
const { SOURCES } = linux;

const rejectsWith = async (promise, kind, message) => {
  const error = await promise.then(() => null, (e) => e);
  assert.ok(error instanceof LiveError, `expected a LiveError, got ${error}`);
  assert.equal(error.kind, kind, error.message);
  if (message) assert.match(error.message, message);
  return error;
};

function storedFields(source) {
  const path = join(keys, `live-token-${source}`);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").trim().split("\n").slice(1);
  return Object.fromEntries(lines.map((line) => {
    const [name, value] = line.split("=");
    return [name, name === "expiresAt" ? Number(value) : Buffer.from(value, "hex").toString()];
  }));
}

function serve(route, ...names) {
  overrides.set(route, names);
}

function pick(route, fallback) {
  const queue = overrides.get(route);
  if (!queue?.length) return fallback;
  return queue.length > 1 ? queue.shift() : queue[0];
}

function defaultFor(host, method, path, body) {
  if (host === "api.github.com") {
    const query = JSON.parse(body).query;
    return ["github", query.includes("LiveFolderDetails") ? "details" : query.includes("LiveFolder") ? "folder" : "viewer"];
  }
  if (host === "github.com") return ["github", path === "/login/device/code" ? "deviceCode" : "deviceToken"];
  if (host === "api.bitbucket.org") {
    if (path === "/2.0/user") return ["bitbucket", "user"];
    if (path.startsWith("/2.0/pullrequests/")) return ["bitbucket", "pullRequestsPage1"];
    if (path.endsWith("/statuses")) return ["bitbucket", "statuses"];
    return ["bitbucket", "pullRequestMerged"];
  }
  if (host === "api.notion.com") return ["notion", path === "/v1/users/me" ? "me" : path === "/v1/search" ? "search" : "users"];
  if (host === "acme.atlassian.net") return ["confluence", path.endsWith("/user/current") ? "current" : "search"];
  if (host === "oauth2.googleapis.com") return ["google", new URLSearchParams(body).get("grant_type") === "refresh_token" ? "refresh" : "codeExchange"];
  return ["google", path === "/drive/v3/about" ? "about" : "files"];
}

function respond(req, res, body) {
  const host = String(req.headers.host ?? "").split(":")[0];
  const url = new URL(req.url, `https://${host}`);
  requests.push({ host, method: req.method, path: url.pathname, search: url.search, headers: { ...req.headers }, body });
  const [provider, fallback] = defaultFor(host, req.method, url.pathname, body);
  const name = pick(`${host} ${url.pathname}`, fallback);
  const fixture = PROVIDERS[provider][name];
  assert.ok(fixture, `${provider} has no ${name} fixture`);
  const text = JSON.stringify(fixture.body);
  res.writeHead(fixture.status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...fixture.headers });
  res.end(text);
}

before(async () => {
  assert.ok(TOOL, "LIVE_HOST_TOOL must name the compiled fixture tool");
  globalThis.fetch = () => {
    throw new Error("Live services must not use renderer fetch");
  };
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => respond(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  tool = spawn(TOOL, [keys, String(server.address().port)], { stdio: ["pipe", "pipe", "inherit"] });
  createInterface({ input: tool.stdout }).on("line", (line) => {
    const reply = JSON.parse(line);
    waiting.get(reply.id)?.(reply);
    waiting.delete(reply.id);
  });
});

beforeEach(() => {
  overrides.clear();
  requests.length = 0;
});

after(async () => {
  tool?.stdin.end();
  await new Promise((resolve) => (tool ? tool.on("exit", resolve) : resolve()));
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

test("GitHub: a token connects from the documented viewer reply and a folder maps the documented pull request shape", async () => {
  await linux.connectGithub(CREDENTIALS.github);
  assert.deepEqual([live().accounts.github.login, live().accounts.github.name], ["octocat", "The Octocat"]);
  const items = await SOURCES.github.fetch(prFolder);
  assert.deepEqual(items.map((it) => [it.title, it.url, it.pr.repo, it.pr.checks[0].state]), [["Amazing new feature", "https://github.com/octocat/Hello-World/pull/1347", "octocat/Hello-World", "success"]]);
  const graphql = requests.filter((r) => r.host === "api.github.com");
  assert.ok(graphql.every((r) => r.method === "POST" && r.headers.authorization === `Bearer ${CREDENTIALS.github}` && r.headers.accept === "application/json"));
});

test("GitHub: bad credentials, the primary and secondary rate limits and SAML enforcement keep their meaning", async () => {
  serve("api.github.com /graphql", "badCredentials");
  await rejectsWith(SOURCES.github.fetch(prFolder), "signedOut");
  serve("api.github.com /graphql", "primaryRateLimit");
  await rejectsWith(SOURCES.github.fetch(prFolder), "rateLimited", /rate limit already exceeded/);
  serve("api.github.com /graphql", "secondaryRateLimit");
  await rejectsWith(SOURCES.github.fetch(prFolder), "rateLimited");
  serve("api.github.com /graphql", "secondaryRateLimitNoRetryAfter");
  await rejectsWith(SOURCES.github.fetch(prFolder), "rateLimited");
  serve("api.github.com /graphql", "ssoRequired");
  await rejectsWith(SOURCES.github.fetch(prFolder), "sso");
  assert.ok(live().accounts.github, "a refresh failure never drops the account");
});

test("GitHub: each documented device-flow poll reply maps to its state", async () => {
  const code = JSON.parse((await call("ArdiaLive.request", ["github", "deviceCode", { clientId: "Iv1.contract" }, "w1#1:code"])).body);
  assert.deepEqual([code.user_code, code.interval, code.expires_in], ["WDJB-MJHT", 5, 900]);
  const [device] = requests.filter((r) => r.host === "github.com");
  assert.equal(device.headers.accept, "application/json");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(device.body)), { client_id: "Iv1.contract", scope: "repo read:org" });
  const poll = (name, id) => {
    serve("github.com /login/oauth/access_token", name);
    return call("ArdiaLive.connect", ["github", { clientId: "Iv1.contract", deviceCode: code.device_code }, `w1#1:${id}`]).then((value) => value, (error) => error);
  };
  assert.deepEqual(await poll("authorizationPending", "p1"), { status: "pending" });
  assert.deepEqual(await poll("slowDown", "p2"), { status: "slowDown", interval: 10 });
  const expired = await poll("expiredToken", "p3");
  assert.deepEqual([expired.code, expired.message], ["ERR_LIVE_SIGNED_OUT", "The code expired"]);
  const denied = await poll("accessDenied", "p4");
  assert.deepEqual([denied.code, denied.message], ["ERR_LIVE_SIGNED_OUT", "Access was denied"]);
  const disabled = await poll("deviceFlowDisabled", "p5");
  assert.deepEqual([disabled.code, disabled.message], ["ERR_LIVE_SIGNED_OUT", "device_flow_disabled"]);
  const token = requests.filter((r) => r.path === "/login/oauth/access_token").at(-1);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(token.body)), { client_id: "Iv1.contract", device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
});

test("GitHub: the device flow waits the documented interval, connects and keeps the token native-side", async () => {
  setAccount("github", null);
  const started = Date.now();
  const flow = await linux.startGithubDeviceFlow("Iv1.contract");
  assert.equal(flow.userCode, "WDJB-MJHT");
  assert.equal(flow.verificationUri, "https://github.com/login/device");
  await flow.done;
  assert.ok(Date.now() - started >= 4900, "the first poll waits the documented 5 s interval");
  assert.equal(live().accounts.github.login, "octocat");
  assert.equal(storedFields("github").token, PROVIDERS.github.deviceToken.body.access_token);
  const viewer = requests.filter((r) => r.host === "api.github.com").at(-1);
  assert.equal(viewer.headers.authorization, `Bearer ${PROVIDERS.github.deviceToken.body.access_token}`);
});

test("Bitbucket: an API token with the account email connects, the first page of pull requests maps with build statuses", async () => {
  await linux.connectBitbucket(CREDENTIALS.bitbucketEmail, CREDENTIALS.bitbucket);
  assert.equal(live().accounts.bitbucket.login, "557058:c0b72ad0-1cb5-4018-9cdc-0cde8492c443");
  const items = await SOURCES.bitbucket.fetch(prFolder);
  assert.deepEqual(items.map((it) => [it.title, it.url, it.pr.headRef, it.pr.checks.map((c) => c.state)]), [["Add retry to the uploader", "https://bitbucket.org/acme/uploader/pull-requests/42", "feature/retry", ["success", "pending"]]]);
  const listed = requests.filter((r) => r.path.startsWith("/2.0/pullrequests/"));
  assert.deepEqual(listed.map((r) => [r.path, r.search]), [["/2.0/pullrequests/557058%3Ac0b72ad0-1cb5-4018-9cdc-0cde8492c443", "?state=OPEN&pagelen=50"]]);
  assert.equal(listed[0].headers.authorization, `Basic ${Buffer.from(`${CREDENTIALS.bitbucketEmail}:${CREDENTIALS.bitbucket}`).toString("base64")}`);
  assert.deepEqual(requests.filter((r) => r.path.endsWith("/statuses")).map((r) => r.path + r.search), ["/2.0/repositories/acme/uploader/pullrequests/42/statuses?pagelen=50"]);
  assert.deepEqual(await SOURCES.bitbucket.resolveGone(items), { [items[0].id]: "merged" });
});

test("Bitbucket: unauthorized, rate-limited and missing-scope replies", async () => {
  serve("api.bitbucket.org /2.0/pullrequests/557058%3Ac0b72ad0-1cb5-4018-9cdc-0cde8492c443", "unauthorized");
  await rejectsWith(SOURCES.bitbucket.fetch(prFolder), "signedOut");
  serve("api.bitbucket.org /2.0/pullrequests/557058%3Ac0b72ad0-1cb5-4018-9cdc-0cde8492c443", "rateLimited");
  await rejectsWith(SOURCES.bitbucket.fetch(prFolder), "rateLimited");
  serve("api.bitbucket.org /2.0/pullrequests/557058%3Ac0b72ad0-1cb5-4018-9cdc-0cde8492c443", "missingScope");
  await rejectsWith(SOURCES.bitbucket.fetch(prFolder), "signedOut", /privilege scopes/);
});

test("Notion: an internal integration connects as its workspace and search maps pages and databases, skipping trashed ones", async () => {
  await linux.connectNotion(CREDENTIALS.notion);
  assert.equal(live().accounts.notion.login, "Acme Docs");
  const items = await SOURCES.notion.fetch(docFolder);
  assert.deepEqual(items.map((it) => [it.title, it.doc.kind, it.icon, it.doc.editedBy]), [
    ["Launch plan", "Page", "🚀", "Avocado Lovelace"],
    ["Roadmap", "Database", "https://www.notion.so/icons/database_gray.svg", "Avocado Lovelace"],
  ]);
  const search = requests.find((r) => r.path === "/v1/search");
  assert.deepEqual(JSON.parse(search.body), { sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 30 });
  assert.equal(search.headers["notion-version"], "2022-06-28");
  assert.equal(requests.filter((r) => r.path === "/v1/search").length, 1, "has_more is not followed");
});

test("Notion: unauthorized, rate-limited, restricted and overloaded replies", async () => {
  serve("api.notion.com /v1/search", "unauthorized");
  await rejectsWith(SOURCES.notion.fetch(docFolder), "signedOut");
  serve("api.notion.com /v1/search", "rateLimited");
  await rejectsWith(SOURCES.notion.fetch(docFolder), "rateLimited");
  serve("api.notion.com /v1/search", "restricted");
  await rejectsWith(SOURCES.notion.fetch(docFolder), "signedOut", /does not have access/);
  serve("api.notion.com /v1/search", "overloaded");
  await rejectsWith(SOURCES.notion.fetch(docFolder), "other", /^529 /);
});

test("Confluence: an API token connects to the site and CQL search maps the expanded space and history", async () => {
  await linux.connectConfluence("acme.atlassian.net", CREDENTIALS.bitbucketEmail, CREDENTIALS.confluence);
  assert.equal(live().accounts.confluence.login, "5b10ac8d82e05b22cc7d4ef5");
  const items = await SOURCES.confluence.fetch(docFolder);
  assert.deepEqual(items.map((it) => [it.title, it.url, it.subtitle, it.doc.editedBy, it.updatedAt]), [
    ["Quarterly planning", "https://acme.atlassian.net/wiki/spaces/ENG/pages/393217/Quarterly+planning", "Engineering", "Emma Example", Date.parse("2026-10-27T12:34:56.789Z")],
  ]);
  const search = requests.find((r) => r.path === "/wiki/rest/api/content/search");
  const params = new URLSearchParams(search.search);
  assert.deepEqual([params.get("limit"), params.get("expand")], ["30", "space,history.lastUpdated"]);
});

test("Confluence: unauthorized, rate-limited and forbidden replies", async () => {
  serve("acme.atlassian.net /wiki/rest/api/content/search", "unauthorized");
  await rejectsWith(SOURCES.confluence.fetch(docFolder), "signedOut");
  serve("acme.atlassian.net /wiki/rest/api/content/search", "rateLimited");
  await rejectsWith(SOURCES.confluence.fetch(docFolder), "rateLimited");
  serve("acme.atlassian.net /wiki/rest/api/content/search", "forbidden");
  await rejectsWith(SOURCES.confluence.fetch(docFolder), "signedOut");
});

test("Google Drive: the documented code exchange connects, files map, and a refresh reply without a refresh token keeps the stored one", async () => {
  await linux.connectGoogle(CREDENTIALS.googleClient, CREDENTIALS.googleSecret, CREDENTIALS.googleCode, CREDENTIALS.googleVerifier, REDIRECT);
  assert.equal(live().accounts.gdrive.login, "emma@acme.example");
  const exchange = Object.fromEntries(new URLSearchParams(requests.find((r) => r.host === "oauth2.googleapis.com").body));
  assert.deepEqual([exchange.grant_type, exchange.redirect_uri, exchange.code], ["authorization_code", REDIRECT, CREDENTIALS.googleCode]);
  const items = await SOURCES.gdrive.fetch(docFolder);
  assert.deepEqual(items.map((it) => [it.title, it.doc.kind, it.doc.editedBy]), [["Budget 2027", "Spreadsheet", "Emma Example"], ["Contract.pdf", "PDF", null]]);
  assert.equal(requests.filter((r) => r.path === "/drive/v3/files").length, 1, "nextPageToken is not followed");
  assert.equal(storedFields("gdrive").token, PROVIDERS.google.codeExchange.body.access_token);
  await call("Tool.advance", [3600_000]);
  assert.equal((await SOURCES.gdrive.fetch(docFolder)).length, 2);
  const stored = storedFields("gdrive");
  assert.equal(stored.token, PROVIDERS.google.refresh.body.access_token);
  assert.equal(stored.refreshToken, PROVIDERS.google.codeExchange.body.refresh_token);
  const renewal = Object.fromEntries(new URLSearchParams(requests.filter((r) => r.host === "oauth2.googleapis.com").at(-1).body));
  assert.deepEqual([renewal.grant_type, renewal.refresh_token], ["refresh_token", PROVIDERS.google.codeExchange.body.refresh_token]);
});

test("Google Drive: an authError on an unexpired token renews once and retries", async () => {
  serve("www.googleapis.com /drive/v3/files", "authError", "files");
  assert.equal((await SOURCES.gdrive.fetch(docFolder)).length, 2);
  assert.equal(requests.filter((r) => r.host === "oauth2.googleapis.com").length, 1);
  assert.equal(requests.filter((r) => r.path === "/drive/v3/files").length, 2);
  serve("www.googleapis.com /drive/v3/files", "authError");
  await rejectsWith(SOURCES.gdrive.fetch(docFolder), "signedOut");
});

test("Google Drive: rate-limit 403s and 429 read as rate limits; missing scopes and a disabled API do not", async () => {
  for (const name of ["userRateLimitExceeded", "rateLimitExceeded403", "rateLimitExceeded429", "dailyLimitExceeded"]) {
    serve("www.googleapis.com /drive/v3/files", name);
    await rejectsWith(SOURCES.gdrive.fetch(docFolder), "rateLimited", undefined).catch((error) => assert.fail(`${name}: ${error.message}`));
  }
  serve("www.googleapis.com /drive/v3/files", "insufficientPermissions");
  await rejectsWith(SOURCES.gdrive.fetch(docFolder), "signedOut", /insufficient authentication scopes/);
  serve("www.googleapis.com /drive/v3/files", "accessNotConfigured");
  await rejectsWith(SOURCES.gdrive.fetch(docFolder), "signedOut", /Drive API has not been used in project/);
});

test("Google Drive: a revoked or expired refresh token reads as signed out", async () => {
  await call("Tool.advance", [3600_000]);
  serve("oauth2.googleapis.com /token", "invalidGrant");
  await rejectsWith(SOURCES.gdrive.fetch(docFolder), "signedOut", /revoked/);
  assert.ok(live().accounts.gdrive);
});
