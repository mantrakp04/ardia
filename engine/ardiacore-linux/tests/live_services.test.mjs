import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { createLiveServices, LIVE_FIXTURE, liveSecretValues } from "../../../apps/linux/scripts/acceptance/lib/liveServices.mjs";
import { hostLiveClient, LIVE_CAPABILITIES } from "../../../apps/linux/src/hostLive.ts";
import { linuxLiveSources } from "../../../apps/linux/src/liveSources.ts";
import { live, setAccount, updateConfig } from "../../../apps/browser/src/state/live/store.ts";
import { LiveError } from "../../../apps/browser/src/state/live/types.ts";

const TOOL = process.env.LIVE_HOST_TOOL;
const scratch = mkdtempSync(join(tmpdir(), "ardia-live-services-"));
const keys = join(scratch, "Ardia Live Tokens");
const services = createLiveServices();
const lines = [];
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

function storedFields(source) {
  const path = join(keys, `live-token-${source}`);
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").trim().split("\n").slice(1);
  return Object.fromEntries(lines.map((line) => {
    const [name, value] = line.split("=");
    return [name, name === "expiresAt" ? Number(value) : Buffer.from(value, "hex").toString()];
  }));
}

async function eventually(test, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const heldWrites = async () => (await call("Tool.stats", [])).heldWrites;

const rejectsWith = async (promise, kind, message) => {
  const error = await promise.then(() => null, (e) => e);
  assert.ok(error instanceof LiveError, `expected a LiveError, got ${error}`);
  assert.equal(error.kind, kind, error.message);
  if (message) assert.match(error.message, message);
  return error;
};

before(async () => {
  assert.ok(TOOL, "LIVE_HOST_TOOL must name the compiled fixture tool");
  globalThis.fetch = () => {
    throw new Error("Live services must not use renderer fetch");
  };
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => void services.handle(req, res, Buffer.concat(chunks).toString("utf8")).then((handled) => {
      if (!handled) {
        res.writeHead(404, { "content-length": 0 });
        res.end();
      }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  tool = spawn(TOOL, [keys, String(server.address().port)], { stdio: ["pipe", "pipe", "inherit"] });
  createInterface({ input: tool.stdout }).on("line", (line) => {
    lines.push(line);
    const reply = JSON.parse(line);
    waiting.get(reply.id)?.(reply);
    waiting.delete(reply.id);
  });
});

after(async () => {
  tool?.stdin.end();
  await new Promise((resolve) => (tool ? tool.on("exit", resolve) : resolve()));
  await new Promise((resolve) => server.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
});

test("each advertised provider connects through the native service and keeps its token native-side", async () => {
  const f = LIVE_FIXTURE;
  await linux.connectGithub(` ${f.github.token} `);
  await linux.connectBitbucket(f.bitbucket.user, f.bitbucket.token);
  await linux.connectNotion(f.notion.token);
  await linux.connectConfluence("acme.atlassian.net/", f.confluence.email, f.confluence.token);
  await linux.connectGoogle(f.gdrive.clientId, f.gdrive.clientSecret, f.gdrive.code, "fixture-verifier-0123456789", "http://127.0.0.1:53682/ardia-oauth");
  const accounts = live().accounts;
  assert.equal(accounts.github.login, f.github.login);
  assert.equal(accounts.bitbucket.login, f.bitbucket.accountId);
  assert.equal(accounts.notion.login, f.notion.workspace);
  assert.equal(accounts.confluence.login, f.confluence.accountId);
  assert.equal(accounts.gdrive.login, f.gdrive.email);
  assert.equal(live().config.confluenceSite, "https://acme.atlassian.net");
  const stored = readdirSync(keys).sort();
  assert.deepEqual(stored, ["live-token-bitbucket", "live-token-confluence", "live-token-gdrive", "live-token-github", "live-token-notion"]);
  for (const name of stored) assert.equal(statSync(join(keys, name)).mode & 0o777, 0o600, name);
  const disk = stored.map((name) => readFileSync(join(keys, name), "utf8")).join("\n");
  const replies = lines.join("\n");
  for (const secret of liveSecretValues()) {
    assert.ok(!disk.includes(secret), "a token is stored in plain text");
    assert.ok(!replies.includes(secret), "a token came back to the renderer");
  }
});

test("refresh maps every provider's fixture data and sends each token only to its own host", async () => {
  const prs = [...(await SOURCES.github.fetch(prFolder)), ...(await SOURCES.bitbucket.fetch(prFolder))];
  assert.deepEqual(prs.map((it) => it.title), ["Fixture pull request one", "Fixture pull request two", "Fixture Bitbucket change"]);
  assert.equal(prs[2].pr.checks[0].state, "success");
  const docs = [...(await SOURCES.notion.fetch(docFolder)), ...(await SOURCES.confluence.fetch(docFolder)), ...(await SOURCES.gdrive.fetch(docFolder))];
  assert.deepEqual(docs.map((it) => it.title), ["Fixture Notion page", "Fixture Confluence page", "Fixture Drive doc"]);
  assert.equal(docs[1].url, "https://acme.atlassian.net/wiki/spaces/FX/pages/c1");
  const tokens = {
    "api.github.com": [LIVE_FIXTURE.github.token],
    "api.bitbucket.org": [LIVE_FIXTURE.bitbucket.token],
    "api.notion.com": [LIVE_FIXTURE.notion.token],
    "acme.atlassian.net": [LIVE_FIXTURE.confluence.token],
  };
  for (const request of services.requests()) {
    assert.equal(request.headers.cookie, undefined);
    const raw = JSON.stringify(request.headers) + request.body + (request.headers.authorization?.startsWith("Basic ") ? Buffer.from(request.headers.authorization.slice(6), "base64").toString() : "");
    for (const [owner, secrets] of Object.entries(tokens)) {
      if (owner === request.host) continue;
      for (const secret of secrets) assert.ok(!raw.includes(secret), `${owner}'s token reached ${request.host}`);
    }
  }
});

test("a restart reads the protected tokens again and keeps refreshing without reconnecting", async () => {
  const before = await call("Tool.stats", []);
  await call("Tool.restart", []);
  assert.equal((await SOURCES.github.fetch(prFolder)).length, 2);
  assert.equal((await SOURCES.notion.fetch(docFolder)).length, 1);
  assert.equal((await SOURCES.gdrive.fetch(docFolder)).length, 1);
  const stats = await call("Tool.stats", []);
  assert.equal(stats.loads - before.loads, 3);
  await Promise.all([SOURCES.github.fetch(prFolder), SOURCES.github.fetch(prFolder)]);
  assert.equal((await call("Tool.stats", [])).loads, stats.loads);
});

test("google access renews once for concurrent refreshes, after expiry and after a server-side revocation", async () => {
  const renewals = services.state.googleRenewals;
  await call("Tool.advance", [3600_000]);
  const results = await Promise.all([1, 2, 3].map(() => SOURCES.gdrive.fetch(docFolder)));
  assert.ok(results.every((items) => items.length === 1));
  assert.equal(services.state.googleRenewals, renewals + 1);
  services.expireGoogleAccess();
  assert.equal((await SOURCES.gdrive.fetch(docFolder)).length, 1);
  assert.equal(services.state.googleRenewals, renewals + 2);
  await call("Tool.restart", []);
  assert.equal((await SOURCES.gdrive.fetch(docFolder)).length, 1);
  assert.equal(services.state.googleRenewals, renewals + 2, "a renewed token survives a restart");
});

test("revoked tokens read as signed out and keep the account so Settings asks to sign back in", async () => {
  services.revokeGithub();
  await rejectsWith(SOURCES.github.fetch(prFolder), "signedOut");
  assert.ok(live().accounts.github);
  services.revokeGoogleRefresh();
  services.expireGoogleAccess();
  await rejectsWith(SOURCES.gdrive.fetch(docFolder), "signedOut", /revoked/);
  services.state.githubTokens.add(LIVE_FIXTURE.github.token);
  services.state.googleRefreshValid = true;
});

test("rate limits and single sign-on keep their meaning", async () => {
  services.state.rateLimited.add("github");
  await rejectsWith(SOURCES.github.fetch(prFolder), "rateLimited");
  services.state.rateLimited.delete("github");
  services.state.githubSso = true;
  await rejectsWith(SOURCES.github.fetch(prFolder), "sso");
  services.state.githubSso = false;
});

test("offline refreshes fail as network errors and the next refresh recovers", async () => {
  await call("Tool.offline", [true]);
  await rejectsWith(SOURCES.notion.fetch(docFolder), "network");
  await rejectsWith(SOURCES.github.fetch(prFolder), "network");
  await call("Tool.offline", [false]);
  assert.equal((await SOURCES.notion.fetch(docFolder)).length, 1);
});

test("cancelling a request aborts it natively and frees its slot", async () => {
  services.state.delayMs.set("api.notion.com", 3000);
  const abort = new AbortController();
  const pending = rejectsWith(client.request("notion", "search", {}, { signal: abort.signal }), "other", /Cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  abort.abort();
  await pending;
  const stats = await call("Tool.stats", []);
  assert.equal(stats.calls, 0);
  assert.equal(stats.active, 0);
  assert.ok(stats.cancels >= 1);
  services.state.delayMs.delete("api.notion.com");
});

test("the native queue bounds concurrent provider requests", async () => {
  services.state.delayMs.set("api.bitbucket.org", 150);
  services.state.maxActive.set("api.bitbucket.org", 0);
  const repeats = await Promise.all(Array.from({ length: 30 }, () => client.request("bitbucket", "statuses", { repo: "fixture/service", id: 7 })));
  assert.equal(repeats.length, 30);
  const peak = services.state.maxActive.get("api.bitbucket.org");
  assert.ok(peak <= 8, `saw ${peak} concurrent requests`);
  assert.ok(peak >= 2);
  services.state.delayMs.delete("api.bitbucket.org");
});

test("the device flow polls through pending and slow-down, connects, and can be cancelled", async () => {
  setAccount("github", null);
  const flow = await linux.startGithubDeviceFlow(LIVE_FIXTURE.github.clientId);
  assert.equal(flow.userCode, "FIXT-0001");
  await flow.done;
  assert.equal(live().accounts.github.login, LIVE_FIXTURE.github.login);
  assert.equal(services.state.devicePolls, 3);
  assert.equal((await SOURCES.github.fetch(prFolder)).length, 2);
  const cancelled = await linux.startGithubDeviceFlow(LIVE_FIXTURE.github.clientId);
  cancelled.cancel();
  await rejectsWith(cancelled.done, "signedOut", /Cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(services.state.devicePolls, 0);
});

test("privileged requests outside the fixed provider contract are refused", async () => {
  const refuse = (method, args) => call(method, args).then(() => null, (e) => e.code);
  assert.equal(await refuse("ArdiaLive.request", ["github", "graphql", { query: "mutation { deleteRepository(input: {}) { clientMutationId } }" }, "r1"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.request", ["github", "fetch", { url: "https://example.com" }, "r2"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.request", ["bitbucket", "user", {}, "r3"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.request", ["bitbucket", "statuses", { repo: "../../user", id: 1 }, "r4"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.request", ["gmail", "search", {}, "r5"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.connect", ["confluence", { site: "http://acme.atlassian.net", email: "a@b.c", token: "t" }, "r6"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.connect", ["confluence", { site: "https://evil.test/steal", email: "a@b.c", token: "t" }, "r7"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.connect", ["gdrive", { clientId: "c", clientSecret: "s", code: "x", verifier: "v", redirectUri: "https://evil.test/cb" }, "r8"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.request", ["github", "graphql", { query: "query { viewer { login } }" }, "bad id!"]), "ERR_LIVE_ARGUMENT");
  assert.equal(await refuse("ArdiaLive.fetch", ["https://example.com"]), "ERR_UNKNOWN_CALL");
  await rejectsWith(linux.connectConfluence("http://acme.atlassian.net", "a@b.c", "t"), "other", /https/);
});

test("a locked keyring is an explicit failure, never a silent success", async () => {
  await call("Tool.locked", [true]);
  await call("Tool.restart", []);
  await rejectsWith(SOURCES.notion.fetch(docFolder), "keyringLocked", /Unlock your keyring/);
  setAccount("notion", null);
  await rejectsWith(linux.connectNotion(LIVE_FIXTURE.notion.token), "keyringLocked", /Unlock your keyring/);
  assert.equal(live().accounts.notion, undefined);
  await call("Tool.locked", [false]);
  await linux.connectNotion(LIVE_FIXTURE.notion.token);
  assert.equal(live().accounts.notion.login, LIVE_FIXTURE.notion.workspace);
});

test("a connect cancelled while its token is being saved keeps the previous token", async () => {
  assert.equal(storedFields("notion").token, LIVE_FIXTURE.notion.token);
  await call("Tool.holdWrites", [true]);
  const abort = new AbortController();
  const pending = rejectsWith(client.connect("notion", { token: LIVE_FIXTURE.notion.altToken }, { signal: abort.signal }), "other", /Cancelled/);
  await eventually(async () => (await heldWrites()) >= 1, "the connect's save to be posted");
  abort.abort();
  await pending;
  await call("Tool.holdWrites", [false]);
  await eventually(async () => storedFields("notion")?.token === LIVE_FIXTURE.notion.token, "the previous Notion token to be restored");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(storedFields("notion").token, LIVE_FIXTURE.notion.token);
});

test("a connect cancelled while its token is being saved leaves no token when there was none", async () => {
  await linux.disconnect("notion");
  assert.equal(storedFields("notion"), null);
  await call("Tool.holdWrites", [true]);
  const abort = new AbortController();
  const pending = rejectsWith(client.connect("notion", { token: LIVE_FIXTURE.notion.altToken }, { signal: abort.signal }), "other", /Cancelled/);
  await eventually(async () => (await heldWrites()) >= 1, "the connect's save to be posted");
  abort.abort();
  await pending;
  await call("Tool.holdWrites", [false]);
  await eventually(async () => (await heldWrites()) === 0 && storedFields("notion") === null, "the cancelled token to be removed");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(storedFields("notion"), null);
  await call("Tool.restart", []);
  await rejectsWith(SOURCES.notion.fetch(docFolder), "notConfigured");
  await linux.connectNotion(LIVE_FIXTURE.notion.token);
});

test("a Google renewal that lands after a reconnect cannot overwrite the new token", async () => {
  const renewals = services.state.googleRenewals;
  services.state.googleRenewDelayMs = 1500;
  await call("Tool.advance", [3600_000]);
  const refresh = SOURCES.gdrive.fetch(docFolder).catch(() => null);
  await eventually(() => services.state.googleRenewals > renewals, "the renewal to start");
  await call("Tool.holdWrites", [true]);
  const f = LIVE_FIXTURE.gdrive;
  const connecting = linux.connectGoogle(f.clientId, f.clientSecret, f.code, "fixture-verifier-0123456789", "http://127.0.0.1:53682/ardia-oauth");
  await eventually(async () => (await heldWrites()) >= 1, "the reconnect's save to be posted");
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await call("Tool.holdWrites", [false]);
  await connecting;
  await refresh;
  services.state.googleRenewDelayMs = 0;
  await eventually(async () => (await heldWrites()) === 0, "the writes to drain");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(services.state.googleIssuedBy[storedFields("gdrive").token], "authorization_code", JSON.stringify({ stored: storedFields("gdrive").token, issued: services.state.googleIssuedBy, renewals: services.state.googleRenewals - renewals }));
});

test("a closed window's in-flight requests are cancelled and free their slots", async () => {
  services.state.delayMs.set("api.notion.com", 1500);
  const gone = call("ArdiaLive.request", ["notion", "search", {}, "w9#1:gone"]).then(() => null, (e) => e.code);
  const kept = call("ArdiaLive.request", ["notion", "search", {}, "w8#1:kept"]).then(() => "ok", (e) => e.code);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await call("Tool.callerGone", ["w9#1"]);
  assert.equal(await gone, "ERR_LIVE_CANCELLED");
  assert.equal(await kept, "ok");
  services.state.delayMs.delete("api.notion.com");
  const stats = await call("Tool.stats", []);
  assert.equal(stats.calls, 0);
  assert.equal(stats.active, 0);
});

test("disconnecting cancels in-flight work, deletes the protected token and survives a restart", async () => {
  services.state.delayMs.set("api.notion.com", 3000);
  const inflight = rejectsWith(SOURCES.notion.fetch(docFolder), "other", /Cancelled/);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await linux.disconnect("notion");
  await inflight;
  services.state.delayMs.delete("api.notion.com");
  for (const source of ["github", "bitbucket", "confluence", "gdrive"]) await linux.disconnect(source);
  assert.deepEqual(readdirSync(keys), []);
  await call("Tool.restart", []);
  for (const source of ["github", "notion", "gdrive"]) {
    await rejectsWith(SOURCES[source].fetch(source === "github" ? prFolder : docFolder), "notConfigured");
  }
  updateConfig({ confluenceSite: "" });
  await rejectsWith(SOURCES.confluence.fetch(docFolder), "notConfigured");
  assert.equal(existsSync(join(keys, "live-token-github")), false);
});

test("an unavailable host is reported, not faked", async () => {
  const bare = linuxLiveSources(hostLiveClient({ ...host, bootstrap: { ...host.bootstrap, capabilities: [] } }));
  await rejectsWith(bare.SOURCES.github.fetch(prFolder), "other", /unavailable/);
  await rejectsWith(bare.connectNotion("secret_x"), "other", /unavailable/);
});
