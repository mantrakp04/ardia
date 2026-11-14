import assert from "node:assert/strict";
import { test } from "node:test";
import { importPreferences } from "../state/legacy/importRules.ts";
import { createGate, DAILY_KEY, INSTALL_KEY, SHARING_KEY, type GateDeps } from "./telemetryGate.ts";
import { recordProblems, type PhoneRecord } from "./telemetrySchema.ts";

const DAY = 86_400_000;
const START = Date.parse("2026-11-14T10:00:00.000Z");

function harness(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  const posts: string[] = [];
  const writes: string[] = [];
  const timers: (() => void)[] = [];
  let clock = START;
  let ids = 0;
  let status = 200;
  const deps: GateDeps = {
    store: {
      read: (key) => stored.get(key) ?? null,
      write: (key, value) => {
        writes.push(key);
        if (value === null) stored.delete(key);
        else stored.set(key, value);
      },
    },
    post: async (body) => {
      posts.push(body);
      return status;
    },
    canPost: () => true,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    device: () => ({ platform: "android", appVersion: "1.0.0", osVersion: "15", environment: "production" }),
    now: () => clock,
    setTimer: (run) => {
      timers.push(run);
      return timers.length;
    },
    clearTimer: () => {},
  };
  const gate = createGate(deps);
  gate.load();
  const runTimers = async () => {
    while (timers.length) {
      timers.shift()!();
      await new Promise((done) => setImmediate(done));
    }
  };
  const sent = (): PhoneRecord[] =>
    posts.flatMap((body) =>
      JSON.parse(body).resourceLogs[0].scopeLogs[0].logRecords.map((record: { attributes: { key: string; value: Record<string, unknown> }[] }) => {
        const decode = (value: Record<string, unknown>) => ("intValue" in value ? Number(value.intValue) : Object.values(value)[0]);
        const values = Object.fromEntries(record.attributes.map((a) => [a.key, decode(a.value)]));
        const { event, uuid, distinct_id, ...properties } = values;
        return { event, uuid, distinct_id, timestamp: new Date(START).toISOString(), properties } as PhoneRecord;
      }),
    );
  return { gate, stored, posts, writes, timers, runTimers, sent, advance: (ms: number) => (clock += ms), fail: (code: number) => (status = code) };
}

test("a fresh install starts with sharing off and no install ID", () => {
  const { gate, stored } = harness();
  assert.equal(gate.isSharing(), false);
  assert.equal(gate.decided(), false);
  assert.equal(stored.get(INSTALL_KEY), undefined);
});

test("the import from the old app cannot switch sharing on", () => {
  const { values } = importPreferences({ [SHARING_KEY]: "on", [INSTALL_KEY]: "00000000-0000-4000-8000-000000000001", "telemetry.enabled": true, shareUsage: true });
  assert.deepEqual(Object.keys(values).filter((key) => key.startsWith("telemetry") || key.startsWith("share")), []);
  const { gate } = harness(values);
  assert.equal(gate.isSharing(), false);
});

test("with sharing off nothing is captured, counted, written or sent", async () => {
  const { gate, posts, writes, timers, runTimers } = harness();
  writes.length = 0;
  gate.capture("app_launched", { legacy_import: "none" });
  gate.count("tabs_opened");
  gate.count("searches");
  gate.rollDaily();
  gate.flushNow();
  await runTimers();
  assert.equal(gate.pending(), 0);
  assert.equal(timers.length, 0);
  assert.deepEqual(posts, []);
  assert.deepEqual(writes, []);
});

test("sharing that was on but lost its install ID reads as off", () => {
  const { gate } = harness({ [SHARING_KEY]: "on", [INSTALL_KEY]: "not-an-id" });
  assert.equal(gate.isSharing(), false);
});

test("turning sharing off drops what is waiting, the day's counts and anything in flight, at once", async () => {
  const { gate, stored, posts, runTimers } = harness();
  gate.setSharing(true, "settings");
  gate.count("tabs_opened");
  gate.capture("app_launched", { legacy_import: "none" });
  assert.equal(gate.pending(), 2);
  assert.ok(stored.get(DAILY_KEY));
  gate.setSharing(false, "settings");
  assert.equal(gate.pending(), 0);
  assert.equal(stored.get(DAILY_KEY), undefined);
  assert.equal(stored.get(SHARING_KEY), "off");
  await runTimers();
  assert.deepEqual(posts, []);
});

test("an answer that arrives after sharing was turned off is ignored, and nothing is sent again", async () => {
  const h = harness();
  h.gate.setSharing(true, "onboarding");
  let release: (code: number) => void = () => {};
  const slow = new Promise<number>((done) => (release = done));
  const posts: string[] = [];
  const gate = createGate({
    store: { read: (key) => h.stored.get(key) ?? null, write: (key, value) => (value === null ? h.stored.delete(key) : h.stored.set(key, value)) && undefined },
    post: (body) => (posts.push(body), slow),
    canPost: () => true,
    newId: () => "00000000-0000-4000-8000-000000000099",
    device: () => ({ platform: "ios", appVersion: "1.0.0", osVersion: "18.1", environment: "production" }),
    now: () => START,
    setTimer: () => 1,
    clearTimer: () => {},
  });
  gate.load();
  gate.capture("app_launched", { legacy_import: "imported" });
  gate.flushNow();
  gate.setSharing(false, "settings");
  release(500);
  await new Promise((done) => setImmediate(done));
  gate.flushNow();
  assert.equal(posts.length, 1);
  assert.equal(gate.pending(), 0);
});

test("every payload the phone can send validates against the schema, with no free text", async () => {
  const { gate, runTimers, sent } = harness();
  gate.setSharing(true, "settings");
  gate.capture("app_launched", { legacy_import: "skipped" });
  gate.capture("perf_launch", { launch_ms: 812, js_ms: 240 });
  for (const field of ["tabs_opened", "searches", "pins_to_mac", "tabs_sent", "page_processes_gone"] as const) gate.count(field);
  await runTimers();
  const records = sent();
  assert.deepEqual(records.map((record) => record.event).sort(), ["app_launched", "perf_launch", "sharing_turned_on"]);
  for (const record of records) assert.deepEqual(recordProblems(record), [], record.event);
});

test("the schema refuses free text, unknown fields and identifiers it doesn't know", () => {
  const base: PhoneRecord = {
    uuid: "00000000-0000-4000-8000-000000000001",
    event: "app_launched",
    distinct_id: "00000000-0000-4000-8000-000000000002",
    timestamp: "2026-11-14T10:00:00.000Z",
    properties: {
      $lib: "ardia-phone-telemetry",
      $lib_version: "1",
      $app_name: "Ardia",
      app: "phone",
      platform: "android",
      $app_version: "1.0.0",
      $os: "Android",
      $os_version: "15",
      $environment: "production",
      $process_person_profile: false,
      $geoip_disable: true,
      $session_id: "00000000-0000-4000-8000-000000000003",
      legacy_import: "none",
    },
  };
  assert.deepEqual(recordProblems(base), []);
  assert.notDeepEqual(recordProblems({ ...base, properties: { ...base.properties, legacy_import: "https://example.com/" } }), []);
  assert.notDeepEqual(recordProblems({ ...base, properties: { ...base.properties, url: "https://example.com/" } }), []);
  assert.notDeepEqual(recordProblems({ ...base, properties: { ...base.properties, $os_version: "Pixel of Ada" } }), []);
  assert.notDeepEqual(recordProblems({ ...base, distinct_id: "ada@example.com" }), []);
  assert.notDeepEqual(recordProblems({ ...base, event: "page_title" as never }), []);
});

test("the day's counts go out once, the first time the day has changed, and start again from zero", async () => {
  const { gate, runTimers, sent, stored, advance } = harness();
  gate.setSharing(true, "settings");
  gate.count("tabs_opened");
  gate.count("tabs_opened");
  gate.count("searches");
  gate.rollDaily();
  advance(DAY);
  gate.rollDaily();
  gate.rollDaily();
  gate.count("pins_to_mac");
  await runTimers();
  const usage = sent().filter((record) => record.event === "usage_counts");
  assert.equal(usage.length, 1);
  assert.equal(usage[0]!.properties.tabs_opened, 2);
  assert.equal(usage[0]!.properties.searches, 1);
  assert.equal(usage[0]!.properties.pins_to_mac, 0);
  assert.deepEqual(recordProblems(usage[0]!), []);
  assert.equal(JSON.parse(stored.get(DAILY_KEY)!).pins_to_mac, 1);
});

test("a day with nothing counted sends nothing", async () => {
  const { gate, runTimers, sent, advance } = harness();
  gate.setSharing(true, "settings");
  gate.rollDaily();
  advance(DAY);
  gate.rollDaily();
  await runTimers();
  assert.deepEqual(sent().map((record) => record.event), ["sharing_turned_on"]);
});

test("a failed send keeps the events and tries again later", async () => {
  const { gate, runTimers, posts, fail } = harness();
  gate.setSharing(true, "settings");
  fail(503);
  gate.flushNow();
  await new Promise((done) => setImmediate(done));
  assert.equal(gate.pending(), 1);
  fail(200);
  await runTimers();
  assert.equal(gate.pending(), 0);
  assert.ok(posts.length >= 2);
});
