import assert from "node:assert/strict";
import { test } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc");

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: false, decidedAt: 1, askDoneAt: 1, installId: null, crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
client.startClient();

const EVENTS = 20_000;
const props = (i) => ({ tabs: i % 300, windows: 2, profile_count: 3, duration_ms: i * 1.5, source: "settings", ok: i % 2 === 0, step: `step_${i % 12}` });
const p = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function run(label) {
  const times = [];
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let i = 0; i < EVENTS; i++) {
    const t = performance.now();
    client.capture("bench_event", props(i));
    times.push(performance.now() - t);
  }
  local.flushLocal();
  const total = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  times.sort((a, b) => a - b);
  const result = { label, events: EVENTS, total_ms: Math.round(total), mean_us: Math.round((total / EVENTS) * 1000), p95_us: Math.round(p(times, 0.95) * 1000), max_ms: +times.at(-1).toFixed(2), heap_growth_mb: +((heapAfter - heapBefore) / 1_048_576).toFixed(1), buffered_after: local.devLocalStore().buffered };
  console.log(JSON.stringify(result));
  return result;
}

test("20k events with sharing off: fast per event, buffer drained, store stays under 8 MB", async () => {
  stub.telemetryLocal.reset();
  const off = run("sharing off");
  assert.equal(off.buffered_after, 0);
  assert.ok(off.p95_us < 500, `p95 ${off.p95_us} µs per capture`);
  assert.ok(stub.telemetryLocal.lines().length === EVENTS);
  const bytes = stub.telemetryLocal.bytes();
  console.log(JSON.stringify({ written_bytes: bytes, bytes_per_line: Math.round(bytes / EVENTS) }));
  for (let round = 0; round < 3; round++) run(`sharing off, round ${round + 2}`);
  const stats = await local.pruneLocalStore(Date.now());
  console.log(JSON.stringify({ after_prune_bytes: stats.bytes, lines: stats.lines, dropped: stats.droppedLines }));
  assert.ok(stats.bytes <= local.LOCAL_MAX_BYTES);
  assert.ok(stats.droppedLines > 0);
});

test("20k events with sharing on: the post queue stays capped at 1,000", () => {
  client.setSharing(true, "settings");
  const on = run("sharing on");
  assert.ok(on.p95_us < 1_000, `p95 ${on.p95_us} µs per capture`);
  assert.ok(client.devState().queued.events <= 1000);
});

test("memory does not grow with the number of events once flushed", () => {
  client.setSharing(false, "settings");
  stub.telemetryLocal.reset();
  run("warm");
  gc();
  const base = process.memoryUsage().heapUsed;
  for (let round = 0; round < 5; round++) {
    run(`steady ${round}`);
    stub.telemetryLocal.reset();
  }
  gc();
  const growth = (process.memoryUsage().heapUsed - base) / 1_048_576;
  console.log(JSON.stringify({ steady_heap_growth_mb_after_100k: +growth.toFixed(1) }));
  assert.ok(growth < 40, `${growth.toFixed(1)} MB retained after 100k events`);
});
