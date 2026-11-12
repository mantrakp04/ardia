import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { startStoreEvents } = await import("./storeEvents.ts");

const S = () => useBrowser.getState();
const MIN = 60_000;

test("tab.idle counts a tab brought back by Restore All as used when it came back", () => {
  S().hydrate({});
  S().updateSettings({ newTabPosition: "bottom" });
  const w = S().createWindow({ url: "https://a.com/" });
  const [, b] = ["b", "c", "d"].reduce((ids, u) => [...ids, S().newTab(w, { url: `https://${u}.com/`, background: true })], [model.viewTabIds(S(), w)[0]]);
  S().updateTab(b, { lastActiveAt: Date.now() - 2 * 60 * MIN });
  S().cleanUpTabs(w, { inactiveForMs: 30 * MIN });
  assert.ok(!S().tabs[b], "cleaned up");
  S().restoreCleaned();
  const sent = [];
  const stop = startStoreEvents((name, data) => sent.push([name, data.url]), { events: new Set(["tab.idle"]), tabIdle: new Set([30 * 60]) });
  stop();
  assert.deepEqual(sent.filter(([, url]) => url === "https://b.com/"), []);
});
