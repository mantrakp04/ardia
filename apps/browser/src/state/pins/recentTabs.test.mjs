import assert from "node:assert/strict";
import { test } from "node:test";
const { recentTabIds } = await import("./tabCleanup.ts");

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;
const tab = (id, page, ago, pin = null) => ({ id, windowId: "w", profileId: "p", page: { kind: page }, pin, lastActiveAt: NOW - ago });
const state = (...tabs) => ({ windows: { w: { id: "w", profileId: "p", tabIds: tabs.map((t) => t.id) } }, tabs: Object.fromEntries(tabs.map((t) => [t.id, t])) });

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
