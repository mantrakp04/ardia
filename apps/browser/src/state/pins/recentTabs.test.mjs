import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { recentTabIds } = await import("./tabCleanup.ts");
const { useLifecycle } = await import("../tabs/sleepingTabs.ts");

const S = () => useBrowser.getState();
const HOUR = 60 * 60 * 1000;

function windowWith(...urls) {
  S().hydrate({});
  useLifecycle.setState({ discarded: {} });
  S().updateSettings({ newTabPosition: "bottom" });
  const w = S().createWindow({ url: `https://${urls[0]}.com/` });
  const ids = [model.viewTabIds(S(), w)[0], ...urls.slice(1).map((u) => S().newTab(w, { url: `https://${u}.com/`, background: true }))];
  S().activate(ids[0]);
  const now = Date.now();
  ids.forEach((id, i) => S().updateTab(id, { lastActiveAt: now - i * HOUR }));
  return [w, now, ...ids];
}

const sleep = (...ids) => useLifecycle.setState({ discarded: Object.fromEntries(ids.map((id) => [id, true])) });

test("the tab switcher lists sleeping tabs by default, as Dia does", () => {
  const [w, now, a, b, c, d] = windowWith("a", "b", "c", "d");
  sleep(c);
  assert.deepEqual(recentTabIds(S(), w, now), [a, b, c, d]);
});

test("with sleeping tabs hidden, the tab switcher skips them and keeps the tab you're on", () => {
  const [w, now, a, b, c, d] = windowWith("a", "b", "c", "d");
  S().updateSettings({ sleepingTabsInSwitcher: false });
  sleep(a, c);
  assert.deepEqual(recentTabIds(S(), w, now), [a, b, d]);
});

test("with sleeping tabs hidden, the two most recent awake tabs show even when older than the switcher's window", () => {
  const [w, now, a, b, c] = windowWith("a", "b", "c");
  S().updateSettings({ sleepingTabsInSwitcher: false });
  S().updateTab(c, { lastActiveAt: now - 20 * HOUR });
  sleep(b);
  assert.deepEqual(recentTabIds(S(), w, now), [a, c]);
});

test("with sleeping tabs hidden, the tab switcher skips a tab whose page isn't loaded", () => {
  const [w, now, a, b, c] = windowWith("a", "b", "c");
  S().updateSettings({ sleepingTabsInSwitcher: false });
  S().updateTab(b, { page: { kind: "idle" } });
  assert.deepEqual(recentTabIds(S(), w, now), [a, c]);
});
