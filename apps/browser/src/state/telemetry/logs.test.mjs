import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install-1", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { recordLog } = await import("./logs.ts");
client.startClient();

const queued = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? '{"events":[],"logs":[]}');
const attributesOf = (log) => Object.fromEntries(log.attributes.map((a) => [a.key, a.value.stringValue]));

test("an Error after the label queues its type, message and code, cleaned", () => {
  const error = Object.assign(new Error("release of tab 1234567 failed for https://example.com/a at /Users/me/host.ts"), { code: "ERR_HOST_GONE" });
  recordLog("error", ["[ardia host] release failed", error]);
  client.saveQueueNow();
  const log = queued().logs.at(-1);
  const attributes = attributesOf(log);
  assert.equal(attributes.error_type, "Error");
  assert.equal(attributes.error_message, "release of tab <n> failed for <url> at <path>");
  assert.equal(attributes.error_code, "ERR_HOST_GONE");
  assert.doesNotMatch(JSON.stringify(log), /example\.com|1234567|\/Users\/me/);
  local.flushLocal();
  const record = stub.telemetryLocal.records().findLast((r) => r.kind === "log");
  assert.equal(record.message, "[ardia host] release failed");
  assert.equal(record.attributes.error_message, "release of tab <n> failed for <url> at <path>");
  assert.equal(record.attributes.error_code, "ERR_HOST_GONE");
});

test("an Error with no message or no usable code adds only what it has", () => {
  recordLog("error", ["[ardia host]", Object.assign(new TypeError(""), { code: "not a code!" })]);
  client.saveQueueNow();
  const attributes = attributesOf(queued().logs.at(-1));
  assert.equal(attributes.error_type, "TypeError");
  assert.ok(!("error_message" in attributes));
  assert.ok(!("error_code" in attributes));
});

test("a log line with no Error keeps error_type none and gets no message or code", () => {
  recordLog("warn", ["a plain warning", { code: "X" }, "detail"]);
  client.saveQueueNow();
  const attributes = attributesOf(queued().logs.at(-1));
  assert.equal(attributes.error_type, "none");
  assert.ok(!("error_message" in attributes));
  assert.ok(!("error_code" in attributes));
});

test("the same label is still queued once and the distinct labels are still capped at 40", () => {
  const before = queued().logs.length;
  recordLog("error", ["[ardia host] release failed", new Error("again")]);
  client.saveQueueNow();
  assert.equal(queued().logs.length, before);
  for (let i = 0; i < 60; i++) recordLog("error", [`distinct label ${"abcdefghij"[i % 10]}${"klmnopqrst"[Math.floor(i / 10)]}`, new Error("x")]);
  client.saveQueueNow();
  assert.equal(queued().logs.length, 40);
});
