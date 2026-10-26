import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "26.1", arch: "arm64", isolatedInstance: false });
const daily = await import("./daily.ts");
const { appInfo } = await import("./client.ts");

const at = (iso) => Date.parse(`${iso}T12:00:00Z`);
const store = (lastDay) => (lastDay ? stub.docs.set(daily.DAILY_DOC, JSON.stringify({ version: 1, lastDay })) : stub.docs.delete(daily.DAILY_DOC));
const posts = [];
let status = 200;
globalThis.fetch = async (url, init) => {
  posts.push({ url, body: JSON.parse(init.body) });
  if (status === 0) throw new Error("offline");
  return { status };
};
const attributes = (post) =>
  Object.fromEntries(post.body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
const reset = (lastDay, installedBefore = false) => {
  store(lastDay);
  posts.length = 0;
  status = 200;
  daily.resetDailyForTests(installedBefore);
};

test("ISO weeks start on Monday, across years", () => {
  assert.equal(daily.isoWeekMonday("2026-10-25"), "2026-10-19");
  assert.equal(daily.isoWeekMonday("2026-10-26"), "2026-10-26");
  assert.equal(daily.isoWeekMonday("2027-01-01"), "2026-12-28");
});

test("flags come from the last ping date alone", () => {
  assert.deepEqual(daily.dailyFlags(null, "2026-10-25", false), { first: true, daily: true, weekly: true, monthly: true });
  assert.deepEqual(daily.dailyFlags(null, "2026-10-25", true), { first: false, daily: true, weekly: true, monthly: true });
  assert.equal(daily.dailyFlags("2026-10-25", "2026-10-25", false), null);
  assert.equal(daily.dailyFlags("2026-10-26", "2026-10-25", false), null);
  assert.deepEqual(daily.dailyFlags("2026-10-24", "2026-10-25", false), { first: false, daily: true, weekly: false, monthly: false });
  assert.deepEqual(daily.dailyFlags("2026-10-25", "2026-10-26", false), { first: false, daily: true, weekly: true, monthly: false });
  assert.deepEqual(daily.dailyFlags("2026-10-31", "2026-11-01", false), { first: false, daily: true, weekly: false, monthly: true });
  assert.deepEqual(daily.dailyFlags("garbage", "2026-10-25", false), { first: true, daily: true, weekly: true, monthly: true });
});

test("days are UTC and the recheck lands just after UTC midnight or within the hour", () => {
  assert.equal(daily.utcDay(Date.parse("2026-10-25T23:59:59-05:00")), "2026-10-26");
  assert.equal(daily.nextCheckDelay(Date.parse("2026-10-25T23:50:00Z"), 0), 10 * 60_000);
  assert.equal(daily.nextCheckDelay(Date.parse("2026-10-25T10:00:00Z"), 0), 60 * 60_000);
  assert.deepEqual([1, 2, 3, 10].map(daily.retryDelay), [60_000, 120_000, 240_000, 3_600_000]);
});

test("one anonymous ping a day, marked only after a 2xx", async () => {
  reset(null);
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "sent");
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "already");
  assert.equal(posts.length, 1);
  const sent = attributes(posts[0]);
  assert.equal(posts[0].url, "https://ardia.dev/otel/v1/logs");
  assert.equal(sent.event, "daily_active");
  assert.equal(sent.uuid, sent.distinct_id);
  assert.match(sent.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(
    { ...sent, uuid: undefined, distinct_id: undefined },
    {
      event: "daily_active",
      uuid: undefined,
      distinct_id: undefined,
      $lib: "ardia-daily",
      $lib_version: "1",
      $app_name: "Ardia",
      $app_version: "0.3.0",
      $os: "macOS",
      os_major: "26",
      arch: "arm64",
      $environment: "production",
      $process_person_profile: false,
      $geoip_disable: true,
      first: true,
      daily: true,
      weekly: true,
      monthly: true,
    },
  );
  assert.equal(daily.readLastDay(), "2026-10-25");

  assert.equal(await daily.sendDailyPing(at("2026-10-26")), "sent");
  const next = attributes(posts[1]);
  assert.notEqual(next.distinct_id, sent.distinct_id);
  assert.deepEqual([next.first, next.weekly, next.monthly], [false, true, false]);
});

test("failures keep the day's ping queued, and retries reuse the same event id", async () => {
  reset("2026-10-24", true);
  status = 503;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  status = 0;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  assert.equal(daily.readDailyState().pending.length, 1);
  status = 204;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "sent");
  assert.deepEqual(daily.readDailyState(), { lastDay: "2026-10-25", pending: [] });
  const ids = posts.map((p) => attributes(p).uuid);
  assert.equal(new Set(ids).size, 1);
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "already");
  assert.equal(posts.length, 3);
});

test("a ping cut off by a quit is resent after relaunch with the same id, and an older day's before today's", async () => {
  reset("2026-10-24", true);
  status = 0;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  const lost = attributes(posts[0]);
  assert.equal(daily.readDailyState().pending[0].id, lost.uuid);

  daily.resetDailyForTests(true);
  status = 200;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "sent");
  assert.equal(attributes(posts[1]).uuid, lost.uuid);
  assert.deepEqual(daily.readDailyState(), { lastDay: "2026-10-25", pending: [] });

  reset("2026-10-24", true);
  status = 503;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  const older = posts[0];
  daily.resetDailyForTests(true);
  status = 200;
  assert.equal(await daily.sendDailyPing(at("2026-10-26")), "sent");
  assert.equal(posts.length, 3);
  assert.equal(attributes(posts[1]).uuid, attributes(older).uuid);
  assert.equal(posts[1].body.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano, older.body.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano);
  const today = attributes(posts[2]);
  assert.notEqual(today.uuid, attributes(older).uuid);
  assert.deepEqual([today.first, today.weekly, today.monthly], [false, true, false]);
  assert.deepEqual(daily.readDailyState(), { lastDay: "2026-10-26", pending: [] });
});

test("a day is only sent once its ping is saved to disk", async () => {
  reset(null);
  stub.heldSaves.on = true;
  const pending = daily.sendDailyPing(at("2026-10-25"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(posts.length, 0);
  stub.heldSaves.on = false;
  for (const land of stub.heldSaves.queue.splice(0)) land();
  assert.equal(await pending, "sent");
  assert.equal(posts.length, 1);
});

test("the last day is a high-water mark: a clock set back sends nothing", async () => {
  reset(null);
  assert.equal(await daily.sendDailyPing(at("2026-10-26")), "sent");
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "already");
  assert.equal(await daily.sendDailyPing(at("2026-10-20")), "already");
  assert.equal(posts.length, 1);
  assert.equal(daily.readLastDay(), "2026-10-26");
});

test("every day seen during an outage is counted, oldest first, each with its own id and flags", async () => {
  reset("2026-10-24", true);
  status = 0;
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  assert.equal(await daily.sendDailyPing(at("2026-10-26")), "failed");
  daily.resetDailyForTests(true);
  posts.length = 0;
  status = 200;
  assert.equal(await daily.sendDailyPing(at("2026-10-27")), "sent");
  const sent = posts.map(attributes);
  assert.deepEqual(sent.map((p) => [p.weekly, p.monthly]), [[false, false], [true, false], [false, false]]);
  assert.equal(new Set(sent.map((p) => p.uuid)).size, 3);
  assert.deepEqual(
    posts.map((p) => new Date(Number(p.body.resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano.slice(0, -6))).toISOString().slice(0, 10)),
    ["2026-10-25", "2026-10-26", "2026-10-27"],
  );
  assert.deepEqual(daily.readDailyState(), { lastDay: "2026-10-27", pending: [] });
});

test("a month-long outage keeps the last 35 days", async () => {
  reset("2026-09-30", true);
  status = 503;
  for (let d = 1; d <= 40; d++) await daily.sendDailyPing(Date.parse("2026-10-01T12:00:00Z") + (d - 1) * 86_400_000);
  const { pending } = daily.readDailyState();
  assert.equal(pending.length, daily.MAX_PENDING);
  assert.equal(pending[0].day, "2026-10-06");
  assert.equal(pending.at(-1).day, "2026-11-09");
});

test("nothing is sent when the pending ping can't be saved first", async () => {
  reset(null);
  const set = stub.docs.set;
  stub.docs.set = () => {
    throw new Error("disk full");
  };
  try {
    assert.equal(await daily.sendDailyPing(at("2026-10-25")), "failed");
  } finally {
    stub.docs.set = set;
  }
  assert.equal(posts.length, 0);
  assert.equal(daily.readLastDay(), null);
});

test("it sends whether or not sharing is on, and leaves the opt-in state alone", async () => {
  reset(null);
  assert.equal(stub.docs.get("telemetry.json"), undefined);
  assert.equal(await daily.sendDailyPing(at("2026-10-25")), "sent");
  assert.equal(stub.docs.get("telemetry.json"), undefined);
  assert.equal(stub.docs.get("telemetry-queue.json"), undefined);
});

test("test instances only send with the telemetry switch", async () => {
  reset(null);
  appInfo().isolatedInstance = true;
  try {
    assert.equal(await daily.sendDailyPing(at("2026-10-25")), "sent");
    assert.equal(posts.length, 0);
  } finally {
    appInfo().isolatedInstance = false;
  }
});
