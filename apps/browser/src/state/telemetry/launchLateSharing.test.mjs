import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false, processStart: Date.now() - 250_000 });
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const journeys = await import("./journeys.ts");
after(() => client.setSharing(false, "settings"));

async function sentLaunches() {
  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json"));
  return saved.events.filter((e) => e.event === "perf_launch").map((e) => ({ launch_ms: e.properties.launch_ms, commit_ms: e.properties.commit_ms }));
}

test("a window opened after sharing is turned on mid-session does not start a launch measured from process start", async () => {
  client.loadChoice();
  assert.equal(client.isSharing(), false);
  journeys.startJourneys(null);

  journeys.launchCommitted();
  client.setSharing(true, "onboarding");
  assert.equal(client.isSharing(), true);
  journeys.launchCommitted();

  assert.deepEqual(journeys.devJourneys().pending, []);
  journeys.journeysEnding();
  assert.deepEqual(await sentLaunches(), []);
});
