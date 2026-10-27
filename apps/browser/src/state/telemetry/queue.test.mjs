import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const older = { uuid: "older", event: "app_launched", distinct_id: "install", timestamp: "2026-10-26T00:00:00.000Z", properties: {} };
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
stub.docs.set("telemetry-queue.json", JSON.stringify({ version: 1, events: [older], logs: [] }));
globalThis.fetch = async () => ({ status: 200 });

let forwarded = [];
let handler = null;
globalThis.ErrorUtils = { getGlobalHandler: () => (error, fatal) => forwarded.push([error, fatal]), setGlobalHandler: (h) => (handler = h) };

const { startClient } = await import("./client.ts");
const { captureException, installErrorReporting } = await import("./errors.ts");
installErrorReporting();

const queuedEvents = () => JSON.parse(stub.docs.get("telemetry-queue.json")).events;

test("an error before the client starts keeps the queue already on disk, once", () => {
  captureException(new RangeError("too early"), "onerror");
  assert.deepEqual(queuedEvents().map((e) => e.uuid === "older" ? "older" : e.event), ["older", "$exception"]);
  startClient();
  const events = queuedEvents();
  assert.equal(events.filter((e) => e.uuid === "older").length, 1);
  assert.equal(events.filter((e) => e.event === "$exception").length, 1);
});

test("a fatal JS error reaches React Native's handler only once its report is on disk", async () => {
  stub.heldSaves.on = true;
  const error = new TypeError("fatal render error");
  handler(error, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(forwarded.length, 0);
  stub.heldSaves.on = false;
  for (const land of stub.heldSaves.queue.splice(0)) land();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(forwarded, [[error, true]]);
  assert.ok(queuedEvents().some((e) => e.properties.$exception_values?.[0] === "fatal render error"));
});

test("a fatal JS error is forwarded anyway when the disk doesn't answer within a second", async () => {
  forwarded = [];
  stub.heldSaves.on = true;
  const started = Date.now();
  handler(new TypeError("disk stuck"), true);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(forwarded.length, 1);
  assert.ok(Date.now() - started < 1500);
  stub.heldSaves.on = false;
  stub.heldSaves.queue.splice(0);
});
