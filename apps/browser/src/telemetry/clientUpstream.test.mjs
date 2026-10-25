import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { appInfo } = await import("../test-native-stub.mjs");
const client = await import("./client.ts");
globalThis.fetch = async () => ({ status: 200 });

test("a build with a telemetry URL offers sharing and turns it on", () => {
  assert.match(appInfo.telemetryURL, /^https:\/\//);
  client.loadChoice();
  assert.equal(client.telemetryAvailable(), true);
  assert.equal(client.useTelemetry.getState().available, true);
  assert.equal(client.isSharing(), false);
  client.setSharing(true, "settings");
  assert.equal(client.isSharing(), true);
  assert.equal(client.useTelemetry.getState().sharing, true);
  client.setSharing(false, "settings");
  assert.equal(client.isSharing(), false);
});
