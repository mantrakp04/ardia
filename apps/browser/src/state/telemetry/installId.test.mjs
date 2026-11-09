import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const newerNightly = { version: 99, sharing: true, installId: "kept-install", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.4.0", sessionOpen: false, fieldFromTheFuture: true };
stub.docs.set("telemetry.json", JSON.stringify(newerNightly));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const savedId = () => JSON.parse(stub.docs.get("telemetry.json")).installId;

test("a state file written by a newer version keeps its install id and sharing choice instead of resetting", () => {
  client.loadChoice();
  assert.equal(client.isSharing(), true);
  client.capture("probe");
  assert.equal(savedId(), "kept-install");
});

test("launching a different app version than the file last saw keeps the install id", () => {
  const session = client.startClient();
  assert.equal(session.updatedFrom, "0.4.0");
  assert.equal(savedId(), "kept-install");
});

test("turning sharing off and on again keeps the same install id", () => {
  client.setSharing(false, "settings");
  assert.equal(client.isSharing(), false);
  assert.equal(savedId(), "kept-install");
  client.setSharing(true, "settings");
  assert.equal(savedId(), "kept-install");
});

test("a first opt-in makes a well-formed random v4 id", async () => {
  const { uuidv4, uuidv7 } = await import("./ids.ts");
  const ids = new Set(Array.from({ length: 200 }, uuidv4));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(uuidv7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
