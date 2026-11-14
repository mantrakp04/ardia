import assert from "node:assert/strict";
import { test } from "node:test";
const { recentTabIds, sessionTabIds } = await import("./tabCleanup.ts");
const { useLifecycle } = await import("../tabs/sleepingTabs.ts");

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const tab = (id, page, ago, pin = null, extra = {}) => ({ id, windowId: "w", profileId: "p", page: { kind: page }, pin, lastActiveAt: NOW - ago, ...extra });
const state = (...tabs) => {
  const active = tabs.find((t) => t.page.kind === "loaded")?.id;
  return {
    windows: { w: { id: "w", profileId: "p", tabIds: tabs.map((t) => t.id), activeTabIds: active ? { p: active } : {} } },
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
  };
};

test("the ⌃Tab switcher lists open tabs by last use and leaves out closed pinned tabs, which only look recent", () => {
  const s = state(
    tab("closedTile", "asleep", 1000, { as: "tile" }),
    tab("closedRow", "asleep", 2000, { as: "row" }),
    tab("current", "loaded", 0),
    tab("restored", "idle", 3 * HOUR),
    tab("openPin", "loaded", HOUR, { as: "tile" }),
  );
  assert.deepEqual(recentTabIds(s, "w", NOW), ["current", "openPin", "restored"]);
});

test("open tabs unused for longer than clean-up's window still drop out, past the two most recent", () => {
  const s = state(tab("a", "loaded", 0), tab("b", "loaded", 20 * HOUR), tab("c", "loaded", 30 * HOUR));
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "b"]);
});

test("Memory Saver discarded tabs stay out of the session list", () => {
  const s = state(tab("a", "loaded", 0), tab("sleeping", "loaded", HOUR), tab("b", "loaded", 2 * HOUR));
  s.windows.w.activeTabIds = { p: "a" };
  useLifecycle.setState({ discarded: { sleeping: true } });
  try {
    assert.deepEqual(sessionTabIds(s, "w", NOW - 4 * HOUR), ["a", "b"]);
  } finally {
    useLifecycle.setState({ discarded: {} });
  }
});

test("newest unseen siblings follow their opener first", () => {
  const s = state(
    tab("a", "loaded", 0),
    tab("older", "loaded", HOUR, null, { openerId: "a", unseen: true, createdAt: NOW - 2 }),
    tab("newer", "loaded", HOUR, null, { openerId: "a", unseen: true, createdAt: NOW - 1 }),
    tab("b", "loaded", 2 * HOUR),
  );
  s.windows.w.activeTabIds = { p: "a" };
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "newer", "older", "b"]);
});

test("unseen nested links stay beside their own opener", () => {
  const s = state(
    tab("a", "loaded", 0),
    tab("link", "loaded", HOUR, null, { openerId: "a", unseen: true, createdAt: NOW - 2 }),
    tab("nested", "loaded", HOUR, null, { openerId: "link", unseen: true, createdAt: NOW - 1 }),
    tab("b", "loaded", 2 * HOUR),
  );
  s.windows.w.activeTabIds = { p: "a" };
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "link", "nested", "b"]);
});
