import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const usage = await import("./usage.ts");
const { useBrowser } = await import("../browser/store.ts");
const { showHistory, takeHistorySearchFocusRequest } = await import("../history/showHistory.ts");
after(() => client.setSharing(false, "settings"));

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("⌘Y's requests for the History search field and the ones the field took are counted in usage_counts", async () => {
  client.setSharing(true, "onboarding");
  const S = useBrowser.getState;
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  showHistory(w);
  showHistory(w);
  takeHistorySearchFocusRequest();
  usage.sessionEnding();
  const sent = await usageCounts();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].history_search_focus_requests, 2);
  assert.equal(sent[0].history_search_focused, 1);
});
