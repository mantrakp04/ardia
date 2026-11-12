import assert from "node:assert/strict";
import { test } from "node:test";

const { sendReport, uploadUrlsFrom, issueNumberOf, resolveUrl, uploadFraction, isBusy, failureClass, failureMessage, RETRY_DELAYS_MS } = await import("./upload.ts");

const endpoint = { url: "http://127.0.0.1:4319/api/feedback", key: "ak_app_x", keyHeader: "X-Ardia-Key" };
const files = [
  { name: "recording.mp4", path: "/d/recording.mp4", bytes: 1000, type: "video/mp4" },
  { name: "trace.json.gz", path: "/d/trace.json.gz", bytes: 500, type: "application/gzip" },
];

function fakeServer({ create = 201, put = () => 200, complete = 200, upload_urls } = {}) {
  const calls = [];
  const handlers = new Set();
  let clock = 0;
  const deps = {
    async postJson(url, body, headers) {
      calls.push({ kind: "post", url, body, headers });
      if (url.endsWith("/complete")) return { status: complete, json: complete < 300 ? { id: "FB-7KQ2", name: "Brave Otter", issue_url: "https://github.com/ardia-browser/ardia/issues/1234" } : { error: "boom" } };
      return { status: create, json: create < 300 ? { id: "FB-7KQ2", name: "Brave Otter", upload_token: "tok", upload_urls: upload_urls ?? { "recording.mp4": "/api/feedback/FB-7KQ2/files/recording.mp4" } } : { error: "title: required" } };
    },
    async putFile(id, url, headers, file) {
      calls.push({ kind: "put", id, url, headers, file: file.name });
      for (const h of handlers) h(id, file.bytes / 2);
      return put(file.name);
    },
    onProgress(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    now: () => (clock += 100),
    sleeps: [],
    async sleep(ms) {
      deps.sleeps.push(ms);
    },
  };
  return { deps, calls };
}

const run = async (server, resume = null, cancelled = () => false) => {
  const states = [];
  const result = await sendReport(server.deps, endpoint, { title: "t" }, files, (s) => states.push(s), resume, cancelled);
  return { result, states };
};

test("a report is created, each file uploaded with the bearer token, then completed", async () => {
  const server = fakeServer();
  const { result, states } = await run(server);
  assert.equal(result.phase, "sent");
  assert.equal(result.sent.id, "FB-7KQ2");
  assert.equal(result.sent.issueNumber, 1234);
  assert.equal(result.sent.bytes, 1500);
  assert.deepEqual(server.calls.map((c) => c.kind), ["post", "put", "put", "post"]);
  assert.equal(server.calls[0].headers["X-Ardia-Key"], "ak_app_x");
  assert.equal(server.calls[1].url, "http://127.0.0.1:4319/api/feedback/FB-7KQ2/files/recording.mp4");
  assert.equal(server.calls[2].url, "http://127.0.0.1:4319/api/feedback/FB-7KQ2/files/trace.json.gz");
  assert.equal(server.calls[1].headers.Authorization, "Bearer tok");
  assert.equal(server.calls[3].url, "http://127.0.0.1:4319/api/feedback/FB-7KQ2/complete");
  assert.deepEqual([...new Set(states.map((s) => s.phase))], ["creating", "uploading", "completing", "sent"]);
  const fractions = states.filter((s) => s.phase === "uploading").map(uploadFraction);
  assert.deepEqual(fractions, [0, 500 / 1500, 1000 / 1500, 1250 / 1500]);
});

test("a refused report fails at create with the server's reason and nothing uploaded", async () => {
  const server = fakeServer({ create: 400 });
  const { result } = await run(server);
  assert.equal(result.phase, "failed");
  assert.equal(result.stage, "create");
  assert.equal(result.created, null);
  assert.equal(result.errorClass, "rejected");
  assert.equal(result.message, "Ardia's report server couldn't accept this report (title: required). Your draft is kept.");
  assert.equal(server.calls.length, 1);
  assert.deepEqual(server.deps.sleeps, []);
});

test("no connection says so", async () => {
  const server = fakeServer();
  server.deps.postJson = async () => {
    throw new Error("offline");
  };
  const { result } = await run(server);
  assert.equal(result.stage, "create");
  assert.equal(result.errorClass, "offline");
  assert.equal(result.attempts, 3);
  assert.deepEqual(server.deps.sleeps, [...RETRY_DELAYS_MS]);
  assert.match(result.message, /^Couldn't reach Ardia's report server\. .*draft is kept\.$/);
});

test("storage down is retried twice with backoff, then explained in a sentence", async () => {
  const server = fakeServer();
  let answers = 0;
  server.deps.postJson = async () => (answers++, { status: 502, json: { error: "upstream:storage", backend: "storage", retryable: true } });
  const { result } = await run(server);
  assert.equal(answers, 3);
  assert.equal(result.phase, "failed");
  assert.equal(result.errorClass, "storage");
  assert.equal(result.status, 502);
  assert.equal(result.message, "Ardia's report server couldn't store this right now. Your draft is kept; try again in a minute.");
});

test("a server that recovers during the retries sends the report and counts the retries", async () => {
  const server = fakeServer();
  const original = server.deps.postJson;
  let failures = 1;
  server.deps.postJson = async (...args) => (failures-- > 0 ? { status: 502, json: { error: "upstream" } } : original(...args));
  let putFailures = 1;
  const put = server.deps.putFile;
  server.deps.putFile = async (...args) => (putFailures-- > 0 ? Promise.reject(new Error("socket hang up")) : put(...args));
  const { result } = await run(server);
  assert.equal(result.phase, "sent");
  assert.equal(result.sent.retries, 2);
  assert.deepEqual(server.deps.sleeps, [RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[0]]);
});

test("rate limits, expired tokens and refusals are not retried", async () => {
  for (const [status, json, errorClass] of [[429, { error: "rate_limited" }, "rate_limited"], [401, { error: "token_expired" }, "expired"], [413, { error: "too_large" }, "rejected"]]) {
    const server = fakeServer();
    server.deps.postJson = async () => ({ status, json });
    const { result } = await run(server);
    assert.equal(result.errorClass, errorClass);
    assert.equal(result.attempts, 1);
    assert.deepEqual(server.deps.sleeps, []);
  }
});

test("every failure class reads as a full sentence that says the draft is kept", () => {
  assert.equal(failureClass(502, { error: "upstream" }), "storage");
  assert.equal(failureClass(502, { error: "upstream:collector" }), "server");
  assert.equal(failureClass(500, { error: "internal" }), "server");
  assert.equal(failureClass(502, null), "server");
  assert.equal(failureClass(401, { error: "bad_key" }), "rejected");
  for (const errorClass of ["offline", "storage", "server", "rate_limited", "expired", "rejected"]) {
    const message = failureMessage(errorClass, 400, null);
    assert.match(message, /[.]$/);
    assert.match(message, /draft is kept/i);
    assert.doesNotMatch(message, /upstream/);
  }
});

test("a failed upload keeps the report and retry sends only what's missing", async () => {
  let fail = true;
  const server = fakeServer({ put: (name) => (name === "trace.json.gz" && fail ? 503 : 200) });
  const first = await run(server);
  assert.equal(first.result.phase, "failed");
  assert.equal(first.result.stage, "upload");
  assert.deepEqual(first.result.created.uploaded, ["recording.mp4"]);
  fail = false;
  server.calls.length = 0;
  const retry = await run(server, first.result.created);
  assert.equal(retry.result.phase, "sent");
  assert.deepEqual(server.calls.map((c) => c.kind === "put" ? c.file : c.url.split("/").pop()), ["trace.json.gz", "complete"]);
});

test("a failed complete retries only the complete call", async () => {
  const server = fakeServer({ complete: 502 });
  const first = await run(server);
  assert.equal(first.result.stage, "complete");
  server.calls.length = 0;
  const retry = await run(fakeServer(), first.result.created);
  assert.equal(retry.result.phase, "sent");
});

test("cancelling stops before the next step and leaves the sheet idle", async () => {
  let cancel = false;
  const server = fakeServer();
  const original = server.deps.putFile;
  server.deps.putFile = async (...args) => {
    cancel = true;
    return original(...args);
  };
  const { result } = await run(server, null, () => cancel);
  assert.equal(result.phase, "idle");
  assert.equal(server.calls.filter((c) => c.kind === "put").length, 1);
});

test("upload urls come from the answer, a list, or the report path", () => {
  assert.deepEqual(uploadUrlsFrom({ upload_urls: [{ name: "recording.mp4", url: "https://x.dev/u/1" }] }, endpoint.url, "FB-1", files.slice(0, 1)), { "recording.mp4": "https://x.dev/u/1" });
  assert.deepEqual(uploadUrlsFrom({ upload_urls: ["/up/a", "/up/b"] }, endpoint.url, "FB-1", files), {
    "recording.mp4": "http://127.0.0.1:4319/up/a",
    "trace.json.gz": "http://127.0.0.1:4319/up/b",
  });
  assert.equal(uploadUrlsFrom({}, endpoint.url, "FB-1", files)["trace.json.gz"], "http://127.0.0.1:4319/api/feedback/FB-1/files/trace.json.gz");
});

test("helpers", () => {
  assert.equal(issueNumberOf("https://github.com/ardia-browser/ardia/issues/77"), 77);
  assert.equal(issueNumberOf(null), null);
  assert.equal(resolveUrl("https://ardia.dev/api/feedback", "/api/x"), "https://ardia.dev/api/x");
  assert.equal(resolveUrl("https://ardia.dev/api/feedback", "https://cdn.dev/x"), "https://cdn.dev/x");
  assert.equal(isBusy({ phase: "creating" }), true);
  assert.equal(isBusy({ phase: "failed", stage: "create", message: "", created: null }), false);
});
