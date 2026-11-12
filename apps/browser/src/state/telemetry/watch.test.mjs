import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const watch = await import("./watch.ts");
const local = await import("./localStore.ts");

const DAY = 86_400_000;
const T = Date.parse("2026-11-01T10:00:00Z");
const state = () => JSON.parse(stub.docs.get("telemetry.json"));
const lastLocal = (event) => (local.flushLocal(), stub.telemetryLocal.records().filter((r) => r.event === event).at(-1));

client.startClient();
after(() => watch.stopWatch());

beforeEach(() => {
  watch.stopWatch();
  client.setSharing(false, "settings");
  watch.watchNoticeShown();
});

test("a watch from someone not sharing turns sharing on for 14 days and tags every event", () => {
  watch.startWatch("FB-1001", 14, T);
  const s = state();
  assert.equal(s.sharing, true);
  assert.ok(s.installId);
  assert.equal(s.watchReport, "FB-1001");
  assert.equal(s.sharingUntil, T + 14 * DAY);
  assert.equal(s.watchUntil, T + 14 * DAY);
  assert.deepEqual(watch.watchStatus(), { report: "FB-1001", until: T + 14 * DAY, turnedSharingOn: true });
  client.capture("during_watch");
  assert.equal(lastLocal("during_watch").properties.watch_report, "FB-1001");
});

test("events carry watch_report while the watch runs on the real clock", () => {
  watch.startWatch("FB-1002");
  client.capture("tagged");
  assert.equal(lastLocal("tagged").properties.watch_report, "FB-1002");
  assert.equal(lastLocal("tagged").sent, true);
});

test("before the end nothing changes; at the end sharing turns off by itself, keeps the id, and says so once", () => {
  watch.startWatch("FB-1003", 14, T);
  const id = state().installId;
  watch.checkWatch(T + 13 * DAY, false);
  assert.equal(state().sharing, true);
  watch.checkWatch(T + 14 * DAY + 1, false);
  const s = state();
  assert.equal(s.sharing, false);
  assert.equal(s.installId, id);
  assert.equal(s.watchReport, null);
  assert.equal(s.sharingUntil, null);
  assert.equal(watch.pendingWatchNotice(), "FB-1003");
  watch.watchNoticeShown();
  assert.equal(watch.pendingWatchNotice(), null);
  assert.equal(lastLocal("watch_ended").properties.reason, "expired");
});

test("a clock set back between launches ends the watch instead of stretching it", () => {
  watch.startWatch("FB-1004", 14, T);
  watch.checkWatch(T + 3 * DAY, false);
  watch.checkWatch(T + 2 * DAY, false);
  assert.equal(state().sharing, false);
  assert.equal(state().watchReport, null);
});

test("a clock set to before the watch began ends it", () => {
  watch.startWatch("FB-1005", 14, T);
  watch.checkWatch(T - DAY, true);
  assert.equal(state().sharing, false);
});

test("a clock set back while running can't add time: elapsed time keeps counting", () => {
  watch.startWatch("FB-1006", 14, T);
  watch.checkWatch(T + 10 * DAY, true);
  watch.checkWatch(T + 5 * DAY, true);
  assert.equal(state().sharing, true);
  assert.ok(state().watchCountedMs >= 10 * DAY);
  watch.checkWatch(T + 9 * DAY, true);
  assert.equal(state().sharing, false, "10 days counted plus 4 more reaches 14 even though the clock says day 9");
});

test("someone already sharing is followed for 14 days without touching their sharing", () => {
  client.setSharing(true, "settings");
  watch.startWatch("FB-1007", 14, T);
  assert.equal(state().sharingUntil, null);
  assert.deepEqual(watch.watchStatus(), { report: "FB-1007", until: T + 14 * DAY, turnedSharingOn: false });
  watch.checkWatch(T + 15 * DAY, false);
  assert.equal(state().sharing, true);
  assert.equal(state().watchReport, null);
  assert.equal(watch.pendingWatchNotice(), null);
});

test("Stop Now turns sharing off at once with no notice", () => {
  watch.startWatch("FB-1008", 14, T);
  watch.stopWatch();
  assert.equal(state().sharing, false);
  assert.equal(state().watchReport, null);
  assert.equal(watch.pendingWatchNotice(), null);
});

test("turning sharing off in Settings during a watch ends the watch", () => {
  watch.startWatch("FB-1009", 14, T);
  client.setSharing(false, "settings");
  assert.equal(state().watchReport, null);
  assert.equal(state().sharingUntil, null);
});

test("a second report during a watch it started keeps sharing temporary", () => {
  watch.startWatch("FB-1010", 14, T);
  watch.startWatch("FB-1011", 14, T + DAY);
  assert.equal(state().sharingUntil, T + 15 * DAY);
  assert.equal(state().watchReport, "FB-1011");
});

test("a watch never runs longer than 14 days, whatever it's asked for", () => {
  watch.startWatch("FB-1012", 90, T);
  assert.equal(state().sharingUntil, T + 14 * DAY);
});
