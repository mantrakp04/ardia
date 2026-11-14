import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const { NativeModules } = await import("react-native");
const processStart = Date.now() - 1500;
Object.assign(stub.appInfo, {
  appVersion: "0.3.0",
  osVersion: "27.0.1",
  arch: "arm64",
  isolatedInstance: false,
  processStart,
  launchMarks: { engineStarted: processStart + 150 },
  launchedHidden: null,
  loadAverage1m: Number.NaN,
});
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, installId: "install", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
NativeModules.ACFieldTiming.drain = () => [["launch", "content", Date.now()]];
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const journeys = await import("./journeys.ts");
const track = await import("./track.ts");
after(() => client.setSharing(false, "settings"));

test("perf_launch leaves out a mark, a load average or a hidden flag the app did not report instead of sending 0 or false", async () => {
  client.loadChoice();
  journeys.startJourneys(null);
  journeys.launchCommitted();
  const deadline = Date.now() + 10_000;
  while (journeys.devJourneys().pending[0]?.usable === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  track.markFirstWindow();
  journeys.emitJourneys();
  journeys.journeysEnding();

  await client.saveQueueNow();
  const saved = JSON.parse(stub.docs.get("telemetry-queue.json"));
  const launches = saved.events.filter((e) => e.event === "perf_launch");
  assert.equal(launches.length, 1);
  const { main_ms, startup_ms, chromium_ms, engine_ms, load_1m, launched_hidden } = launches[0].properties;
  assert.deepEqual([main_ms, startup_ms, chromium_ms, load_1m, launched_hidden], [null, null, null, null, null]);
  assert.equal(engine_ms, 150);
});
