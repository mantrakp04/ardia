import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const kept = { uuid: "kept", event: "app_launched", distinct_id: "install", timestamp: "2026-10-26T00:00:00.000Z", properties: {} };
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, installId: null, decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
stub.docs.set("telemetry-queue.json", JSON.stringify({ version: 1, events: [kept, 7, { uuid: "no-props", event: "x" }], logs: "broken" }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");

test("sharing saved without an install id reads as not sharing, so neither events nor logs are queued", () => {
  client.loadChoice();
  assert.equal(client.isSharing(), false);
  client.queueLog("error", "should stay local", {});
  client.capture("should_stay_local");
  assert.deepEqual(client.devState().queued, { events: 0, logs: 0 });
});

test("a damaged queue on disk keeps its well-formed events and drops the rest without throwing", async () => {
  client.setSharing(true, "settings");
  assert.deepEqual(client.devState().queued, { events: 2, logs: 0 });
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json"));
  assert.deepEqual(saved.events.map((e) => (e.uuid === "kept" ? "kept" : e.event)), ["kept", "sharing_turned_on"]);
  assert.deepEqual(saved.logs, []);
});
