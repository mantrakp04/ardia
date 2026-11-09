import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const now = Date.now();
Object.assign(stub.appInfo, { appVersion: "0.3.1", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false, processStart: now - 2000, bootTime: now - 60_000 });
stub.docs.set(
  "telemetry.json",
  JSON.stringify({ version: 1, sharing: true, installId: "install", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.3.1", sessionOpen: true, lastLaunchAt: now - 1000, context: null }),
);
globalThis.fetch = async () => ({ status: 503 });

const client = await import("./client.ts");
const { trackDrmDiagnostic } = await import("./protectedMedia.ts");
after(() => client.setSharing(false, "settings"));

const queued = async () => {
  await client.saveQueueNow();
  return JSON.parse(stub.docs.get("telemetry-queue.json") ?? "{}").events?.filter((e) => e.event === "protected_media") ?? [];
};
const report = (over = {}) => ({ host: "v.qq.com", keySystem: "com.widevine.alpha", stage: "waitingforkey", code: 0, main: true, blockedHosts: [], ...over });
client.startClient();

test("a failed key-system request on Tencent Video is recorded with its host, key system and code", async () => {
  trackDrmDiagnostic(report({ stage: "accessDenied", code: 9, blockedHosts: ["ad.qq.com", "cdn.example.net"] }));
  const [event] = await queued();
  assert.equal(event.properties.host, "v.qq.com");
  assert.equal(event.properties.key_system, "com.widevine.alpha");
  assert.equal(event.properties.stage, "accessDenied");
  assert.equal(event.properties.code, 9);
  assert.equal(event.properties.main, true);
  assert.equal(event.properties.blocked_hosts_n, 2);
  assert.deepEqual(event.properties.blocked_hosts, ["ad.qq.com", "cdn.example.net"]);
});

test("a media error on a subdomain of a streaming site is recorded with the blocker's hosts", async () => {
  trackDrmDiagnostic(report({ host: "player.v.qq.com", stage: "error", code: 4, keySystem: "", main: false, blockedHosts: ["tracker.example.org"] }));
  const events = await queued();
  const event = events.find((e) => e.properties.host === "player.v.qq.com");
  assert.equal(event.properties.stage, "error");
  assert.equal(event.properties.code, 4);
  assert.equal(event.properties.main, false);
  assert.deepEqual(event.properties.blocked_hosts, ["tracker.example.org"]);
});

test("a host that is not a streaming site records nothing", async () => {
  const before = (await queued()).length;
  trackDrmDiagnostic(report({ host: "example.com" }));
  trackDrmDiagnostic(report({ host: "mail.qq.com" }));
  trackDrmDiagnostic(report({ host: "v.qq.com.evil.example" }));
  assert.equal((await queued()).length, before);
});

test("nothing but hostnames, a key system and numbers is stored: no URLs, paths or queries", async () => {
  const before = (await queued()).length;
  trackDrmDiagnostic(report({ host: "https://v.qq.com/x/cover/abc?token=secret" }));
  trackDrmDiagnostic(report({ host: "v.qq.com/path" }));
  assert.equal((await queued()).length, before);
  trackDrmDiagnostic(report({ stage: "encrypted", keySystem: "com.widevine.alpha?token=secret", blockedHosts: ["https://ad.qq.com/p?q=1", "ad.qq.com/x", "ok.example.com"] }));
  const events = await queued();
  const event = events.find((e) => e.properties.stage === "encrypted");
  assert.equal(event.properties.key_system, "");
  assert.deepEqual(event.properties.blocked_hosts, ["ok.example.com"]);
  assert.equal(JSON.stringify(events).includes("secret"), false);
  assert.equal(JSON.stringify(events).includes("/x/cover"), false);
});

test("the same record is kept once, and a session keeps at most 30", async () => {
  const before = (await queued()).length;
  trackDrmDiagnostic(report({ stage: "accessDenied", code: 9 }));
  trackDrmDiagnostic(report({ stage: "accessDenied", code: 9 }));
  assert.equal((await queued()).length, before);
  for (let code = 100; code < 160; code++) trackDrmDiagnostic(report({ stage: "error", code }));
  assert.equal((await queued()).length, 30);
});

test("with sharing off nothing is queued", async () => {
  client.setSharing(false, "settings");
  trackDrmDiagnostic(report({ host: "www.netflix.com", stage: "accessDenied", code: 1 }));
  assert.equal((await queued()).some((e) => e.properties.host === "www.netflix.com"), false);
});
