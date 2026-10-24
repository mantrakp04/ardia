import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { sessionTabIds } = await import("./organize.ts");

const S = () => useBrowser.getState();

test("the tab switcher lists only tabs opened or visited since launch, most recent first", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://old.example/" });
  const old = S().windows[w].activeTabIds[S().windows[w].profileId];
  const older = S().newTab(w, { url: "https://older.example/", background: true });
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [old]: { ...s.tabs[old], createdAt: 1, lastActiveAt: 1 }, [older]: { ...s.tabs[older], createdAt: 1, lastActiveAt: 2 } } }));
  const start = 100;
  const fast = S().newTab(w, { url: "https://fast.com/" });
  const google = S().newTab(w, { url: "https://google.com/" });
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [fast]: { ...s.tabs[fast], lastActiveAt: 200 }, [google]: { ...s.tabs[google], lastActiveAt: 300 } } }));
  const ids = sessionTabIds(S(), w, start);
  assert.deepEqual(ids.map((id) => S().tabs[id].url), ["https://google.com/", "https://fast.com/"]);
  assert.ok(!ids.includes(older));
  assert.equal(ids[0], google);
  assert.ok(ids.includes(fast));
});
