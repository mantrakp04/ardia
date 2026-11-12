import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { githubIssues, localEvents, localIssues, localStore, otlpEvents, seaweedStore } from "../lib/backends.mjs";
import { APP_INGEST_KEY, CLI_INGEST_KEY, SITE_INGEST_KEY, anonymousIdentity } from "../lib/core.mjs";
import { createService } from "../lib/service.mjs";

const INSTALL = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60";
const SECRET = "x".repeat(40);
const servers = [];
const dirs = [];
after(async () => {
  for (const s of servers) s.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function localService(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ardia-feedback-test-"));
  dirs.push(dir);
  const logs = [];
  const handle = createService({
    store: localStore(dir), events: localEvents(dir), issues: localIssues(dir), secret: SECRET,
    publicUrl: (req) => `http://${req.headers.host}`, dashboardUrl: "https://dash.example", rateLimits: false, log: (l) => logs.push(l), ...options,
  });
  const { url } = await listen(handle);
  return { url, dir, logs };
}

const report = (over = {}) => ({
  kind: "bug", title: "Sidebar flickers", description: "Flickers, mail me at a@b.co", source: "app", install_id: INSTALL,
  app_version: "0.2.45", app_build: "4512", channel: "nightly", os_version: "26.1", arch: "arm64", contact: "a@b.co",
  watch_days: 14, diagnostics: { tabs: 3 },
  attachments: [{ name: "recording.mp4", bytes: 2048, type: "video/mp4" }, { name: "crash-1.ips", bytes: 5, type: "text/plain" }],
  ...over,
});

const post = (url, body, { key = APP_INGEST_KEY, token, type = "application/json" } = {}) =>
  fetch(url, {
    method: "POST",
    headers: { ...(type ? { "Content-Type": type } : {}), ...(key ? { "X-Ardia-Key": key } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const put = (url, token, body, headers = {}) => fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}`, ...headers }, body });

test("local mode: create, upload, complete, and complete again", async () => {
  const { url, dir } = await localService();
  const created = await post(`${url}/api/feedback`, report());
  assert.equal(created.status, 201);
  const answer = await created.json();
  assert.match(answer.id, /^FB-[2-9A-HJ-NP-Z]{4}$/);
  assert.equal(answer.name, anonymousIdentity(INSTALL).name);
  assert.deepEqual(Object.keys(answer.upload_urls), ["recording.mp4", "crash-1.ips"]);
  assert.equal(answer.upload_urls["recording.mp4"], `${url}/api/feedback/${answer.id}/files/recording.mp4`);
  assert.ok(Date.parse(answer.expires_at) > Date.now() + 23 * 3600 * 1000);

  const up = await put(answer.upload_urls["recording.mp4"], answer.upload_token, Buffer.alloc(2048, 7));
  assert.equal(up.status, 200);
  assert.deepEqual(await up.json(), { name: "recording.mp4", bytes: 2048 });

  const [first, second] = await Promise.all([
    post(`${url}/api/feedback/${answer.id}/complete`, "", { token: answer.upload_token, type: null }),
    post(`${url}/api/feedback/${answer.id}/complete`, "", { token: answer.upload_token, type: null }),
  ]);
  assert.equal(first.status, 200);
  const done = await first.json();
  assert.deepEqual(await second.json(), done);
  assert.equal(done.id, answer.id);
  assert.equal(done.name, answer.name);
  assert.match(done.issue_url, /^file:\/\/.*issue\.md$/);

  const again = await post(`${url}/api/feedback/${answer.id}/complete`, "", { token: answer.upload_token, type: null });
  assert.deepEqual(await again.json(), done);

  const folder = join(dir, "feedback", answer.id);
  assert.equal((await stat(join(folder, "recording.mp4"))).size, 2048);
  const issue = await readFile(join(folder, "issue.md"), "utf8");
  assert.match(issue, /Labels: feedback, bug/);
  assert.match(issue, /mail me at \[email\]/);
  assert.ok(!issue.includes("a@b.co"));
  const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.ingest_key, "app");
  const attrs = Object.fromEntries(event.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map((a) => [a.key, Object.values(a.value)[0]]));
  assert.equal(attrs.event, "feedback_submitted");
  assert.equal(attrs.feedback_id, answer.id);
  assert.equal(attrs.contact, "a@b.co");
  assert.equal(attrs.description, "Flickers, mail me at a@b.co");
  assert.equal(attrs.has_recording, true);
  assert.equal(attrs.attachment_count, "1");
  assert.deepEqual(JSON.parse(attrs.attachments).map((a) => a.received), [true, false]);
  assert.ok(attrs.watch_until.startsWith(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)));

  const late = await put(answer.upload_urls["crash-1.ips"], answer.upload_token, "hello");
  assert.equal(late.status, 409);
});

test("keys: missing, site and mismatched keys are refused", async () => {
  const { url } = await localService();
  assert.equal((await post(`${url}/api/feedback`, report(), { key: null })).status, 403);
  assert.equal((await post(`${url}/api/feedback`, report(), { key: SITE_INGEST_KEY })).status, 403);
  assert.equal((await post(`${url}/api/feedback`, report(), { key: "ak_app_nope" })).status, 403);
  assert.equal((await post(`${url}/api/feedback`, report(), { key: CLI_INGEST_KEY })).status, 403);
  const cli = await post(`${url}/api/feedback`, report({ source: "cli", cli_version: "0.4.0", app_version: null, attachments: [] }), { key: CLI_INGEST_KEY });
  assert.equal(cli.status, 201);
  const { id, upload_token } = await cli.json();
  assert.equal((await post(`${url}/api/feedback/${id}/complete`, "", { token: upload_token, key: APP_INGEST_KEY, type: null })).status, 403);
  assert.equal((await post(`${url}/api/feedback/${id}/complete`, "", { token: upload_token, key: CLI_INGEST_KEY, type: null })).status, 200);
});

test("bad requests get clear errors", async () => {
  const { url } = await localService();
  const invalid = await post(`${url}/api/feedback`, report({ title: "" }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid", message: "title: required" });
  assert.equal((await post(`${url}/api/feedback`, "{nope")).status, 400);
  assert.equal((await post(`${url}/api/feedback`, report(), { type: "text/plain" })).status, 415);
  assert.equal((await post(`${url}/api/feedback`, { ...report(), diagnostics: { x: "y".repeat(130 * 1024) } })).status, 413);
  assert.equal((await fetch(`${url}/api/feedback`)).status, 405);
  assert.equal((await fetch(`${url}/api/nope`)).status, 404);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);

  const { id, upload_token, upload_urls } = await (await post(`${url}/api/feedback`, report())).json();
  const other = await (await post(`${url}/api/feedback`, report())).json();
  const file = upload_urls["crash-1.ips"];
  assert.equal((await put(file, "", "hello")).status, 401);
  assert.equal((await put(file, other.upload_token, "hello")).status, 401);
  assert.equal((await put(file, `${upload_token}x`, "hello")).status, 401);
  assert.equal((await put(`${url}/api/feedback/${id}/files/crash-2.ips`, upload_token, "hello")).status, 404);
  assert.equal((await put(`${url}/api/feedback/${id}/files/..%2Freport.json`, upload_token, "hello")).status, 404);
  assert.equal((await put(`${url}/api/feedback/FB-2222/files/crash-1.ips`, upload_token, "hello")).status, 401);
  assert.equal((await put(file, upload_token, "hello!")).status, 413);
  assert.equal((await put(file, upload_token, "hell")).status, 400);
  assert.equal((await put(file, upload_token, "hello")).status, 200);
  assert.equal((await post(`${url}/api/feedback/${id}/complete`, "", { token: other.upload_token, type: null })).status, 401);
});

test("streamed uploads with no length stop at the declared size", async () => {
  const { url, dir } = await localService();
  const { id, upload_token, upload_urls } = await (await post(`${url}/api/feedback`, report())).json();
  const stream = (size) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(size)); c.close(); } });
  const over = await fetch(upload_urls["recording.mp4"], { method: "PUT", headers: { Authorization: `Bearer ${upload_token}` }, body: stream(4096), duplex: "half" }).catch((e) => e);
  assert.ok(over instanceof Error || over.status === 413);
  await assert.rejects(stat(join(dir, "feedback", id, "recording.mp4")));
  const exact = await fetch(upload_urls["recording.mp4"], { method: "PUT", headers: { Authorization: `Bearer ${upload_token}` }, body: stream(2048), duplex: "half" });
  assert.equal(exact.status, 200);
});

test("rate limits answer 429 per address", async () => {
  const { url } = await localService({ rateLimits: true });
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await post(`${url}/api/feedback`, report({ attachments: [] }))).status);
  assert.deepEqual(statuses, [...Array(10).fill(201), 429]);
});

test("production backends: SeaweedFS, the collector and GitHub", async () => {
  const files = new Map();
  const filer = await listen(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.method === "PUT") {
      files.set(req.url, Buffer.concat(chunks));
      res.writeHead(201).end("{}");
    } else if (req.method === "DELETE") {
      files.delete(req.url);
      res.writeHead(204).end();
    } else if (!files.has(req.url)) res.writeHead(404).end();
    else res.writeHead(200, { "Content-Length": files.get(req.url).length }).end(req.method === "HEAD" ? undefined : files.get(req.url));
  });
  const posted = [];
  let collectorUp = true;
  const collector = await listen(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!collectorUp) return res.writeHead(503).end("collector down");
    posted.push({ url: req.url, ingest: req.headers["x-ardia-ingest"], body: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
  const issuesSeen = [];
  let githubUp = true;
  const github = await listen(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    issuesSeen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
    if (!githubUp) return res.writeHead(503).end("down");
    res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ number: 42, html_url: "https://github.com/o/r/issues/42" }));
  });
  const timers = [];
  const logs = [];
  const handle = createService({
    store: seaweedStore("127.0.0.1", filer.port), events: otlpEvents("127.0.0.1", collector.port),
    issues: githubIssues("tok", "o/r", github.url), secret: SECRET, publicUrl: () => "https://ardia.example",
    dashboardUrl: "https://dash.example", rateLimits: false, log: (l) => logs.push(l), later: (fn, ms) => timers.push({ fn, ms }),
  });
  const { url } = await listen(handle);

  const created = await (await post(`${url}/api/feedback`, report())).json();
  assert.equal(created.upload_urls["crash-1.ips"], `https://ardia.example/api/feedback/${created.id}/files/crash-1.ips`);
  assert.ok(files.has(`/buckets/feedback/${created.id}/report.json`));
  const local = `${url}/api/feedback/${created.id}/files/`;
  assert.equal((await put(`${local}crash-1.ips`, created.upload_token, "hello")).status, 200);
  assert.equal(files.get(`/buckets/feedback/${created.id}/crash-1.ips`).toString(), "hello");
  assert.equal((await put(`${local}recording.mp4`, created.upload_token, Buffer.alloc(100))).status, 400);
  assert.equal(files.has(`/buckets/feedback/${created.id}/recording.mp4`), false);

  const done = await (await post(`${url}/api/feedback/${created.id}/complete`, "", { token: created.upload_token, type: null })).json();
  assert.equal(done.issue_url, "https://github.com/o/r/issues/42");
  assert.equal(issuesSeen[0].url, "/repos/o/r/issues");
  assert.equal(issuesSeen[0].auth, "Bearer tok");
  assert.deepEqual(issuesSeen[0].body.labels, ["feedback", "bug"]);
  assert.ok(!JSON.stringify(issuesSeen[0].body).includes("a@b.co"));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, "/v1/logs");
  assert.equal(posted[0].ingest, "app");
  const attrs = Object.fromEntries(posted[0].body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map((a) => [a.key, Object.values(a.value)[0]]));
  assert.equal(attrs.issue_number, "42");
  assert.equal(attrs.distinct_id, INSTALL);

  githubUp = false;
  const second = await (await post(`${url}/api/feedback`, report({ attachments: [] }))).json();
  const quiet = await post(`${url}/api/feedback/${second.id}/complete`, "", { token: second.upload_token, type: null });
  assert.equal(quiet.status, 200);
  assert.equal((await quiet.json()).issue_url, null);
  const quietAttrs = Object.fromEntries(posted[1].body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map((a) => [a.key, Object.values(a.value)[0]]));
  assert.match(quietAttrs.issue_error, /github 503/);

  collectorUp = false;
  const third = await (await post(`${url}/api/feedback`, report({ attachments: [] }))).json();
  githubUp = true;
  const kept = await post(`${url}/api/feedback/${third.id}/complete`, "", { token: third.upload_token, type: null });
  assert.equal(kept.status, 200);
  const keptAnswer = await kept.json();
  assert.equal(keptAnswer.id, third.id);
  assert.equal(keptAnswer.issue_url, "https://github.com/o/r/issues/42");
  const pending = JSON.parse(files.get(`/buckets/feedback/${third.id}/complete.json`));
  assert.equal(pending.event_sent, false);
  assert.ok(logs.some((l) => l.includes(`${third.id} event not sent (collector)`) && l.includes("collector 503")));
  const issuesBefore = issuesSeen.length;
  const again = await post(`${url}/api/feedback/${third.id}/complete`, "", { token: third.upload_token, type: null });
  assert.deepEqual(await again.json(), keptAnswer);
  assert.equal(issuesSeen.length, issuesBefore);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 30_000);
  await timers.shift().fn();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 120_000);
  collectorUp = true;
  const before = posted.length;
  await timers.shift().fn();
  assert.equal(posted.length, before + 1);
  assert.equal(JSON.parse(files.get(`/buckets/feedback/${third.id}/complete.json`)).event_sent, true);
  assert.equal(timers.length, 0);
});

test("a report completed while the collector was down sends its event on the next complete after a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ardia-feedback-test-"));
  dirs.push(dir);
  let up = false;
  const sent = [];
  const flaky = { describe: () => "flaky", send: async (id, ingest, body) => { if (!up) throw new Error("collector 503"); sent.push(body); } };
  const make = () => createService({
    store: localStore(dir), events: flaky, issues: null, secret: SECRET, publicUrl: (req) => `http://${req.headers.host}`,
    dashboardUrl: "https://dash.example", rateLimits: false, log: () => {}, later: () => {},
  });
  const first = await listen(make());
  const created = await (await post(`${first.url}/api/feedback`, report({ attachments: [] }))).json();
  assert.equal((await post(`${first.url}/api/feedback/${created.id}/complete`, "", { token: created.upload_token, type: null })).status, 200);
  assert.equal(JSON.parse(await readFile(join(dir, "feedback", created.id, "complete.json"), "utf8")).event_sent, false);
  up = true;
  const second = await listen(make());
  assert.equal((await post(`${second.url}/api/feedback/${created.id}/complete`, "", { token: created.upload_token, type: null })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(await readFile(join(dir, "feedback", created.id, "complete.json"), "utf8")).event_sent, true);
});

test("storage that refuses writes answers 502 upstream:storage, retryable, and logs the filer's reason", async () => {
  const filer = await listen(async (req, res) => {
    for await (const _ of req);
    if (req.method === "HEAD" || req.method === "GET") return res.writeHead(404).end();
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "failed to find writable volumes for collection:feedback: No writable volumes and no free volumes left" }));
  });
  const logs = [];
  const handle = createService({
    store: seaweedStore("127.0.0.1", filer.port), events: { describe: () => "none", send: async () => {} }, issues: null, secret: SECRET,
    publicUrl: () => "https://ardia.example", dashboardUrl: "https://dash.example", rateLimits: false, log: (l) => logs.push(l),
  });
  const { url } = await listen(handle);
  const res = await post(`${url}/api/feedback`, report());
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.deepEqual(await res.json(), { error: "upstream:storage", backend: "storage", retryable: true, message: "report storage is unavailable; try again in a minute" });
  assert.ok(logs.some((l) => l.startsWith("[feedback] POST /api/feedback failed (storage):") && l.includes("No writable volumes")));
});

test("unreachable storage is blamed on storage, and a bug in the service answers 500 internal", async () => {
  const closed = await listen(() => {});
  const port = closed.port;
  closed.server.close();
  const logs = [];
  const { url } = await listen(createService({
    store: seaweedStore("127.0.0.1", port), events: { describe: () => "none", send: async () => {} }, issues: null, secret: SECRET,
    publicUrl: () => "https://ardia.example", dashboardUrl: "https://dash.example", rateLimits: false, log: (l) => logs.push(l),
  }));
  const down = await post(`${url}/api/feedback`, report());
  assert.equal(down.status, 502);
  assert.equal((await down.json()).error, "upstream:storage");

  const broken = await localService({ publicUrl: () => { throw new TypeError("boom"); } });
  const bug = await post(`${broken.url}/api/feedback`, report());
  assert.equal(bug.status, 500);
  assert.equal((await bug.json()).error, "internal");
  assert.ok(broken.logs.some((l) => l.includes("failed (internal): TypeError: boom")));
});
