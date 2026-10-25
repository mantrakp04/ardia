import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { sessionTabIds } = await import("./organize.ts");

const S = () => useBrowser.getState();
const HOUR = 60 * 60 * 1000;

function stamp(times) {
  useBrowser.setState((s) => {
    const tabs = { ...s.tabs };
    for (const [id, [createdAt, lastActiveAt]] of Object.entries(times)) tabs[id] = { ...tabs[id], createdAt, lastActiveAt };
    return { tabs };
  });
}

test("the tab switcher lists exactly the tabs opened or visited since launch, most recent first", () => {
  S().hydrate({});
  const now = Date.now();
  const start = now - HOUR;
  const w = S().createWindow({ url: "https://old.example/" });
  const old = S().windows[w].activeTabIds[S().windows[w].profileId];
  const older = S().newTab(w, { url: "https://older.example/", background: true });
  const revisited = S().newTab(w, { url: "https://revisited.example/", background: true });
  const fast = S().newTab(w, { url: "https://fast.com/", background: true });
  const google = S().newTab(w, { url: "https://google.com/" });
  stamp({
    [old]: [now - 4 * HOUR, now - 3 * HOUR],
    [older]: [now - 4 * HOUR, now - 3.5 * HOUR],
    [revisited]: [now - 5 * HOUR, now - 30 * 60 * 1000],
    [fast]: [now - 20 * 60 * 1000, now - 10 * 60 * 1000],
    [google]: [now - 5 * 60 * 1000, now - 1000],
  });
  assert.deepEqual(sessionTabIds(S(), w, start), [google, fast, revisited]);
});

test("with fewer than two tabs since launch the switcher falls back to recent tabs", () => {
  S().hydrate({});
  const now = Date.now();
  const w = S().createWindow({ url: "https://old.example/" });
  const old = S().windows[w].activeTabIds[S().windows[w].profileId];
  const fresh = S().newTab(w, { url: "https://fresh.example/" });
  stamp({ [old]: [now - 4 * HOUR, now - 3 * HOUR], [fresh]: [now - 60 * 1000, now - 1000] });
  assert.deepEqual(sessionTabIds(S(), w, now - HOUR), [fresh, old]);
});
