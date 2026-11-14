import assert from "node:assert/strict";
import { test } from "node:test";
const { recentTabIds, sessionTabIds } = await import("./tabCleanup.ts");
const { useLifecycle } = await import("../tabs/sleepingTabs.ts");

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const tab = (id, page, ago, pin = null, extra = {}) => ({ id, windowId: "w", profileId: "p", page: { kind: page }, pin, lastActiveAt: NOW - ago, createdAt: NOW - ago, ...extra });
const state = (...tabs) => {
  const active = tabs.find((t) => t.page.kind === "loaded")?.id;
  return {
    windows: { w: { id: "w", profileId: "p", tabIds: tabs.map((t) => t.id), activeTabIds: active ? { p: active } : {} } },
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
  };
};
const shown = (s, id) => {
  s.windows.w.activeTabIds = { p: id };
  return s;
};
const link = (id, openerId, at) => tab(id, "loaded", 0, null, { unseen: true, openerId, createdAt: at, lastActiveAt: at });

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

test("the tab on screen stays listed even when it has not been used for longer than clean-up's window", () => {
  const s = shown(state(tab("a", "loaded", 20 * HOUR), tab("b", "loaded", HOUR), tab("c", "loaded", 13 * HOUR)), "a");
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "b"]);
});

test("the tab you are on leads, then the links opened from it, newest click first", () => {
  const s = shown(
    state(
      tab("a", "loaded", 0),
      tab("older", "loaded", 2 * HOUR),
      link("x", "a", NOW - 2000),
      link("y", "a", NOW - 1000),
    ),
    "a",
  );
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "y", "x", "older"]);
});

test("every tab ranks by when it was last used, wherever it was opened from", () => {
  const s = shown(
    state(
      tab("a", "loaded", 0),
      tab("b", "loaded", 10_000),
      link("x", "b", NOW - 5000),
      tab("c", "loaded", 20_000),
      link("y", "c", NOW - 15_000),
    ),
    "a",
  );
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "x", "b", "y", "c"]);
});

test("a link opened from a link ranks by when it was opened, like every other tab", () => {
  const s = shown(
    state(
      tab("a", "loaded", 0),
      tab("b", "loaded", 2 * HOUR),
      link("link", "a", NOW - HOUR),
      link("nested", "link", NOW - 30 * 60 * 1000),
    ),
    "a",
  );
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "nested", "link", "b"]);
});

test("the tab on screen leads even when its saved use time is the oldest", () => {
  const s = shown(state(tab("a", "loaded", 3 * HOUR), tab("b", "loaded", HOUR)), "a");
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "b"]);
});

test("the tab on screen stays listed when it is an unloaded pinned row", () => {
  const s = shown(state(tab("a", "asleep", 0, { as: "row" }), tab("b", "loaded", HOUR)), "a");
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "b"]);
});

test("a link opened long ago ranks behind tabs used since", () => {
  const s = shown(state(tab("a", "loaded", 0), tab("older", "loaded", 2 * HOUR), link("x", null, NOW - 3 * HOUR)), "a");
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "older", "x"]);
});

test("links clicked in the same millisecond still come up newest first by their place in the window", () => {
  const s = shown(state(tab("a", "loaded", 0), tab("older", "loaded", 2 * HOUR), link("x", "a", NOW), link("y", "a", NOW)), "a");
  assert.deepEqual(recentTabIds(s, "w", NOW), ["a", "y", "x", "older"]);
});

