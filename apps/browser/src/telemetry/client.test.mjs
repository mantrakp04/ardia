import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { appInfo, docs } = await import("../test-native-stub.mjs");
appInfo.telemetryURL = "";
const client = await import("./client.ts");

test("a build with no telemetry URL can't turn sharing on, asks nothing and sends nothing", async () => {
  const posted = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    posted.push(url);
    return { status: 200 };
  };
  try {
    docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, installId: "earlier", decidedAt: 1, askDoneAt: 1 }));
    client.loadChoice();
    assert.equal(client.telemetryAvailable(), false);
    assert.equal(client.isSharing(), false);
    assert.equal(client.useTelemetry.getState().available, false);
    client.setSharing(true, "settings");
    assert.equal(client.isSharing(), false);
    client.capture("something_happened");
    await client.flush();
    assert.deepEqual(posted, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});
