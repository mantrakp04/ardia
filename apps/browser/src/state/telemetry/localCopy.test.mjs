import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install-1", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
const requests = [];
globalThis.fetch = async (url, init) => (requests.push({ url, ...init }), { status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { sendDailyPing } = await import("./daily.ts");
const { APP_INGEST_KEY } = await import("@ardia/core");

const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const state = () => JSON.parse(stub.docs.get("telemetry.json"));
const queued = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[],"logs":[]}');
const session = client.startClient();

test("each launch gets a v7 session id, saved in telemetry.json while the app runs", () => {
  assert.ok(session);
  assert.match(state().sessionId, UUID7);
});

test("every event and log line carries the session id, queued and in the local copy", () => {
  client.capture("probe_a", { n: 1 }, { persist: true });
  client.queueLog("warn", "a warning", { error_type: "none" });
  client.saveQueueNow();
  const sessionId = state().sessionId;
  for (const e of queued().events) assert.equal(e.properties.$session_id, sessionId);
  const log = queued().logs.at(-1);
  assert.ok(log.attributes.some((a) => a.key === "$session_id" && a.value.stringValue === sessionId));
  local.flushLocal();
  const records = stub.telemetryLocal.records();
  const probe = records.find((r) => r.event === "probe_a");
  assert.equal(probe.sent, true);
  assert.equal(probe.distinct_id, "install-1");
  assert.equal(probe.properties.$session_id, sessionId);
  assert.equal(records.find((r) => r.kind === "log").attributes.$session_id, sessionId);
  for (const line of stub.telemetryLocal.lines()) assert.match(line, /^\{"at":\d+,"kind":"(event|log)","sent":(true|false),/);
});

test("posts send the app's ingest key", async () => {
  await client.flush();
  assert.ok(requests.length > 0);
  for (const r of requests) assert.equal(r.headers["X-Ardia-Key"], APP_INGEST_KEY);
});

test("local writes are batched: nothing reaches the store until 10 s pass, then one append per day", (t) => {
  local.flushLocal();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const before = stub.telemetryLocal.appendCalls;
  for (let i = 0; i < 50; i++) client.capture("batched", { i });
  assert.equal(stub.telemetryLocal.appendCalls, before);
  t.mock.timers.tick(9_999);
  assert.equal(stub.telemetryLocal.appendCalls, before);
  t.mock.timers.tick(1);
  assert.equal(stub.telemetryLocal.appendCalls, before + 1);
  assert.equal(stub.telemetryLocal.records().filter((r) => r.event === "batched").length, 50);
});

test("a fatal error writes the local copy at once, synchronously", () => {
  client.capture("before_crash");
  const before = stub.telemetryLocal.appendNowCalls;
  void client.saveQueueNow();
  assert.equal(stub.telemetryLocal.appendNowCalls, before + 1);
  assert.ok(stub.telemetryLocal.records().some((r) => r.event === "before_crash"));
});

test("with sharing off events are still built and kept locally, without the install id, and never posted", async () => {
  client.setSharing(false, "settings");
  const posts = requests.length;
  client.capture("while_off", { x: 1 });
  client.queueLog("error", "an error while off", { error_type: "TypeError" });
  local.flushLocal();
  const off = stub.telemetryLocal.records().find((r) => r.event === "while_off");
  assert.equal(off.sent, false);
  assert.equal(off.distinct_id, null);
  assert.match(off.properties.$session_id, UUID7);
  assert.equal(stub.telemetryLocal.records().find((r) => r.message === "an error while off").sent, false);
  assert.deepEqual(queued(), { version: 1, events: [], logs: [] });
  await client.flush();
  assert.equal(requests.length, posts);
  assert.equal(state().installId, "install-1");
});

test("the daily count stays out of the local copy, so it can't be tied to anything", async () => {
  await sendDailyPing(Date.parse("2026-11-07T12:00:00Z"));
  local.flushLocal();
  assert.ok(!stub.telemetryLocal.records().some((r) => r.event === "daily_active"));
});

test("a line over 256 KB is dropped and counted instead of written", () => {
  local.flushLocal();
  const lines = stub.telemetryLocal.lines().length;
  client.capture("huge", {}, { raw: { blob: "x".repeat(300_000) } });
  local.flushLocal();
  assert.equal(stub.telemetryLocal.lines().length, lines);
  assert.ok(local.devLocalStore().oversize >= 1);
});

test("a burst flushes early at 2,000 lines so the buffer never grows unbounded", () => {
  local.flushLocal();
  const before = stub.telemetryLocal.appendCalls;
  for (let i = 0; i < 4_500; i++) client.capture("burst");
  assert.ok(stub.telemetryLocal.appendCalls >= before + 2);
  assert.ok(local.devLocalStore().buffered < 2_000);
});

test("lines land in the file of their UTC day", () => {
  local.recordLocal("event", false, { event: "late" }, Date.parse("2026-11-06T23:59:59.999Z"));
  local.recordLocal("event", false, { event: "early" }, Date.parse("2026-11-07T00:00:00.000Z"));
  local.flushLocal();
  assert.match(stub.telemetryLocal.files.get("2026-11-06"), /"event":"late"/);
  assert.match(stub.telemetryLocal.files.get("2026-11-07"), /"event":"early"/);
});

test("the report export takes only lines since the given time", async () => {
  stub.telemetryLocal.reset();
  const now = Date.now();
  local.recordLocal("event", false, { event: "old" }, now - 60 * 60_000);
  local.recordLocal("event", false, { event: "recent" }, now - 60_000);
  const exported = await local.localEventsSince(now - 10 * 60_000);
  assert.equal(exported.lines, 1);
  assert.match(stub.telemetryLocal.exports.at(-1).text, /"recent"/);
  assert.doesNotMatch(stub.telemetryLocal.exports.at(-1).text, /"old"/);
});

test("quitting clears the session id and writes the local copy synchronously", () => {
  client.capture("last_event");
  const before = stub.telemetryLocal.appendNowCalls;
  client.endSession();
  assert.equal(state().sessionId, null);
  assert.equal(state().sessionOpen, false);
  assert.equal(stub.telemetryLocal.appendNowCalls, before + 1);
  assert.ok(stub.telemetryLocal.records().some((r) => r.event === "last_event"));
});

test("the hourly measurement reports size, timings, drops and posts", async () => {
  const { reportLocalStore, LOCAL_STORE_EVENT } = await import("./localStoreReport.ts");
  client.setSharing(true, "settings");
  client.capture("one_more");
  const props = await reportLocalStore();
  for (const key of ["bytes", "lines", "files", "write_ms_p95", "prune_ms", "lines_dropped", "queue_bytes", "bytes_posted", "failed_posts"]) assert.ok(key in props, key);
  local.flushLocal();
  assert.equal(stub.telemetryLocal.records().at(-1).event, LOCAL_STORE_EVENT);
});
