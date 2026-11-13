import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { noteCaptureIndicatorCleared, noteTabSlept, takeTabSleepCounts } = await import("./tabSleepCounts.ts");
const takePinnedTabsSleptByMemorySaver = () => takeTabSleepCounts().pinned_tabs_slept_by_memory_saver;
after(() => client.setSharing(false, "settings"));

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("only a pinned tab that Memory Saver's timer put to sleep counts", () => {
  noteTabSlept(true, "proactive");
  noteTabSlept(false, "proactive");
  noteTabSlept(true, "external");
  noteTabSlept(true, "urgent");
  noteTabSlept(true, "suggested");
  noteTabSlept(true, "frozen");
  noteTabSlept(true, null);
  assert.equal(takePinnedTabsSleptByMemorySaver(), 1);
  assert.equal(takePinnedTabsSleptByMemorySaver(), 0, "taking the count starts it again at zero");
});

test("an hour with only pinned tabs put to sleep still sends usage_counts, and the count resets after", async () => {
  client.setSharing(true, "onboarding");
  noteTabSlept(true, "proactive");
  noteTabSlept(true, "proactive");
  usage.sessionEnding();
  const sent = await usageCounts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].pinned_tabs_slept_by_memory_saver, 2);
  assert.equal(sent[0].capture_indicators_cleared, 0);
  noteCaptureIndicatorCleared();
  usage.sessionEnding();
  assert.deepEqual((await usageCounts()).map((p) => [p.capture_indicators_cleared, p.pinned_tabs_slept_by_memory_saver]), [[0, 2], [1, 0]]);
  usage.sessionEnding();
  assert.equal((await usageCounts()).length, 2);
});
