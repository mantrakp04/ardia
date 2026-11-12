import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { noteTabSwitcherOpenedInWebKit } = await import("./tabSwitcherOpens.ts");
after(() => client.setSharing(false, "settings"));

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("switcher opens over a WebKit page are counted while not sharing but never sent, and the count starts again at zero", async () => {
  client.loadChoice();
  assert.equal(client.isSharing(), false);
  noteTabSwitcherOpenedInWebKit();
  usage.sessionEnding();
  assert.deepEqual(await usageCounts(), []);
});

test("an hour with only switcher opens over a WebKit page still sends usage_counts, the quit record carries them, and they reset after", async () => {
  client.setSharing(true, "onboarding");
  noteTabSwitcherOpenedInWebKit();
  noteTabSwitcherOpenedInWebKit();
  usage.sessionEnding();
  const sent = await usageCounts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tab_switcher_opens_in_webkit, 2);
  assert.equal(sent[0].tab_switcher_opens, 0);
  usage.sessionEnding();
  assert.equal((await usageCounts()).length, 1);
  noteTabSwitcherOpenedInWebKit();
  usage.sessionEnding();
  assert.deepEqual((await usageCounts()).map((p) => p.tab_switcher_opens_in_webkit), [2, 1]);
});
