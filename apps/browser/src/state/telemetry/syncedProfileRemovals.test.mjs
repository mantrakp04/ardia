import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { markRemoved } = await import("../sync/profileRemoval.ts");
after(() => client.setSharing(false, "settings"));

const docWith = (...syncIds) => ({
  profiles: {},
  scopes: { app: { records: Object.fromEntries(syncIds.map((id) => [`prof:${id}`, { h: "1", v: { n: id, c: "blue", i: null } }])) } },
});

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("an hour whose only activity is removing profiles from sync still sends their count, then starts again at zero", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  const doc = docWith("work", "school");
  assert.equal(markRemoved(doc, "work"), true);
  assert.equal(markRemoved(doc, "school"), true);
  usage.sessionEnding();
  assert.deepEqual((await usageCounts()).map((p) => p.synced_profiles_removed), [2]);
  usage.sessionEnding();
  assert.equal((await usageCounts()).length, 1);
});
