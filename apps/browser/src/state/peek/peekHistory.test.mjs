import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
globalThis.fetch = async () => ({ status: 200 });

const client = await import("../telemetry/client.ts");
const usage = await import("../telemetry/usage.ts");
const { useBrowser } = await import("../browser/store.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { peekHistoryOf, stepPeekHistory } = await import("./peekHistory.ts");
after(() => client.setSharing(false, "settings"));

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function peekWithView() {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
  const w = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[w].tabIds[0];
  const id = S().openPeek(a, "https://peek.example/");
  const view = { back: 0, forward: 0 };
  webviews.set(id, { goBack: async () => void view.back++, goForward: async () => void view.forward++ });
  return { w, a, id, view };
}

async function usageCounts() {
  await client.saveQueueNow();
  const queue = stub.docs.get("telemetry-queue.json");
  return queue ? JSON.parse(queue).events.filter((e) => e.event === "usage_counts").map((e) => e.properties) : [];
}

test("a fresh Peek has nowhere to go: back would only close it, so the Peek's back button stays off", () => {
  const { w, id, view } = peekWithView();
  assert.deepEqual(peekHistoryOf(S(), id), { back: false, forward: false });
  stepPeekHistory(w, -1);
  stepPeekHistory(w, 1);
  assert.equal(S().peeks[w]?.tabId, id);
  assert.deepEqual(view, { back: 0, forward: 0 });
  webviews.delete(id);
});

test("after a link inside the Peek, back and forward move through the Peek's own pages", () => {
  const { w, a, id, view } = peekWithView();
  S().updateTab(id, { url: "https://peek.example/next" }, { isLoading: false, canGoBack: true, canGoForward: false });
  assert.deepEqual(peekHistoryOf(S(), id), { back: true, forward: false });
  stepPeekHistory(w, -1);
  assert.equal(view.back, 1);
  S().updateTab(id, { url: "https://peek.example/" }, { isLoading: false, canGoBack: false, canGoForward: true });
  assert.deepEqual(peekHistoryOf(S(), id), { back: false, forward: true });
  stepPeekHistory(w, 1);
  assert.equal(view.forward, 1);
  assert.equal(S().peeks[w]?.tabId, id);
  assert.equal(S().windows[w].activeTabIds.default, a);
  webviews.delete(id);
});

test("steps through a Peek's pages are counted in usage_counts, steps that went nowhere aren't", async () => {
  client.setSharing(true, "onboarding");
  usage.sessionEnding();
  const before = (await usageCounts()).length;
  const { w, id } = peekWithView();
  stepPeekHistory(w, -1);
  S().updateTab(id, { url: "https://peek.example/next" }, { isLoading: false, canGoBack: true, canGoForward: true });
  stepPeekHistory(w, -1);
  stepPeekHistory(w, -1);
  stepPeekHistory(w, 1);
  usage.sessionEnding();
  const sent = (await usageCounts()).slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].peek_history_backs, 2);
  assert.equal(sent[0].peek_history_forwards, 1);
  webviews.delete(id);
});
