import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const identity = await import("./identity.ts");
const local = await import("./localStore.ts");
const watch = await import("./watch.ts");
const { anonymousIdentity } = await import("@ardia/core");

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const savedId = () => JSON.parse(stub.docs.get("telemetry.json") ?? "{}").installId ?? null;

client.startClient();

test("a fresh install has no install id and no name, only a session id", () => {
  const me = identity.telemetryIdentity();
  assert.equal(me.installId, null);
  assert.equal(me.name, null);
  assert.equal(me.avatar, null);
  assert.match(me.sessionId, UUID7);
});

test("a report without sharing or a watch gets a fresh one-time id and makes no install id", () => {
  const a = identity.reportIdentity(false);
  const b = identity.reportIdentity(false);
  assert.equal(a.kind, "one-time");
  assert.match(a.id, UUID4);
  assert.notEqual(a.id, b.id);
  assert.equal(savedId(), null);
  assert.equal(a.name, anonymousIdentity(a.id).name);
});

test("choosing the watch makes the install id once and reuses it", () => {
  const first = identity.reportIdentity(true);
  assert.equal(first.kind, "install");
  assert.match(first.id, UUID4);
  assert.equal(savedId(), first.id);
  assert.equal(identity.reportIdentity(true).id, first.id);
  assert.equal(client.isSharing(), false);
});

test("sharing on uses the same install id; the identity shows its name and avatar", () => {
  const id = savedId();
  client.setSharing(true, "settings");
  assert.equal(savedId(), id);
  assert.equal(identity.reportIdentity(false).id, id);
  const me = identity.telemetryIdentity();
  assert.deepEqual({ name: me.name, avatar: me.avatar }, anonymousIdentity(id));
  client.setSharing(false, "settings");
  client.setSharing(true, "settings");
  assert.equal(savedId(), id);
});

test("Reset makes a new id, empties the queue and deletes the local copy", async () => {
  const old = savedId();
  client.capture("before_reset");
  local.flushLocal();
  assert.ok(stub.telemetryLocal.lines().length > 0);
  const fresh = await identity.resetAnonymousId();
  assert.notEqual(fresh, old);
  assert.match(fresh, UUID4);
  assert.equal(savedId(), fresh);
  assert.equal(client.isSharing(), true);
  const events = JSON.parse(stub.docs.get("telemetry-queue.json")).events;
  assert.ok(events.every((e) => e.distinct_id === fresh));
  local.flushLocal();
  assert.ok(stub.telemetryLocal.records().every((r) => r.distinct_id !== old));
});

test("Reset starts a new session id, so events under the old and new ids share nothing", async () => {
  const before = identity.telemetryIdentity().sessionId;
  await identity.resetAnonymousId();
  const after = identity.telemetryIdentity().sessionId;
  assert.notEqual(after, before);
  client.capture("after_reset");
  local.flushLocal();
  const last = stub.telemetryLocal.records().at(-1);
  assert.equal(last.properties?.$session_id ?? last.$session_id, after);
});

test("Reset during a watch that turned sharing on ends sharing instead of keeping it on for good", async () => {
  client.setSharing(false, "settings");
  watch.startWatch("FB-TEST", 14);
  assert.equal(client.isSharing(), true);
  await identity.resetAnonymousId();
  assert.equal(client.isSharing(), false);
  assert.equal(watch.watchStatus(), null);
});

test("the short id is the first 8 characters", () => {
  assert.equal(identity.shortInstallId("3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f60718"), "3f2a9c1e");
});
