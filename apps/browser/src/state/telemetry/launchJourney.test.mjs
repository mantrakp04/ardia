import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const { NativeModules } = await import("react-native");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false, processStart: Date.now() - 1500 });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, installId: "install", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
NativeModules.ACFieldTiming.drain = () => [["launch", "content", Date.now()]];
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const journeys = await import("./journeys.ts");
const track = await import("./track.ts");
after(() => client.setSharing(false, "settings"));

test("a launch with sharing on at start sends one perf_launch with launch_ms, however many windows open", async () => {
  client.loadChoice();
  assert.equal(client.isSharing(), true);
  journeys.startJourneys(null);

  journeys.launchCommitted();
  journeys.launchCommitted();
  assert.equal(journeys.devJourneys().pending.length, 1);
  const deadline = Date.now() + 10_000;
  while (journeys.devJourneys().pending[0]?.usable === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.notEqual(journeys.devJourneys().pending[0]?.usable, undefined);
  track.markFirstWindow();
  journeys.launchCommitted();
  journeys.emitJourneys();
  journeys.journeysEnding();

  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json"));
  const launches = saved.events.filter((e) => e.event === "perf_launch");
  assert.equal(launches.length, 1);
  const { launch_ms, commit_ms, usable_ms } = launches[0].properties;
  assert.ok(launch_ms >= 1500 && launch_ms < 60_000, `launch_ms ${launch_ms}`);
  assert.ok(commit_ms >= 1500 && commit_ms <= launch_ms, `commit_ms ${commit_ms}`);
  assert.ok(usable_ms >= 1500 && usable_ms < 60_000, `usable_ms ${usable_ms}`);
});
