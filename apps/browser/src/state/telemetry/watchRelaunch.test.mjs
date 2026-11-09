import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const DAY = 86_400_000;
const startedAt = Date.now() - 15 * DAY;
stub.docs.set(
  "telemetry.json",
  JSON.stringify({
    version: 1,
    sharing: true,
    installId: "watched-install",
    decidedAt: 1,
    askDoneAt: 1,
    crashCursor: 0,
    lastVersion: "0.3.0",
    sessionOpen: false,
    watchReport: "FB-2001",
    watchStartedAt: startedAt,
    watchUntil: startedAt + 14 * DAY,
    sharingUntil: startedAt + 14 * DAY,
    watchCountedMs: DAY,
    watchCheckedAt: startedAt + DAY,
  }),
);
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const watch = await import("./watch.ts");
const state = () => JSON.parse(stub.docs.get("telemetry.json"));

test("a watch that ended while Ardia was closed turns sharing off at the next launch and leaves one notice", () => {
  client.startClient();
  watch.startWatchChecks();
  assert.equal(state().sharing, false);
  assert.equal(state().installId, "watched-install");
  assert.equal(state().watchReport, null);
  assert.equal(watch.pendingWatchNotice(), "FB-2001");
});

test("the notice survives a relaunch until it is shown, then never comes back", async () => {
  assert.equal(state().watchEndedNotice, "FB-2001");
  watch.watchNoticeShown();
  assert.equal(state().watchEndedNotice, null);
});
