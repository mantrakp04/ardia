import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { setUrlAnchor } = await import("../windows/layout.ts");
after(() => client.setSharing(false, "settings"));

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("the sidebar's address field moving in the window is counted once per move, not when it is first measured or only resized", async () => {
  client.loadChoice();
  client.setSharing(true, "onboarding");
  const field = (left, width = 172) => ({ left, top: 46, width, sidebar: { height: 34 } });
  setUrlAnchor("w", field(9));
  setUrlAnchor("w", field(9));
  setUrlAnchor("w", field(9, 160));
  setUrlAnchor("w", field(1179, 160));
  setUrlAnchor("w", { left: 300, top: 8, width: 400 });
  usage.sessionEnding();
  assert.deepEqual((await usageCounts()).map((p) => p.sidebar_field_moves), [1]);
});
