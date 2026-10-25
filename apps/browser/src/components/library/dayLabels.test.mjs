process.env.TZ = "America/New_York";
import assert from "node:assert/strict";
import { test } from "node:test";
const { byDay } = await import("./state.ts");

test("day labels count calendar days, also across a daylight-saving change", () => {
  const now = new Date(2026, 2, 9, 0, 30);
  const items = [{ t: new Date(2026, 2, 7, 23, 30).getTime() }, { t: new Date(2026, 2, 8, 1, 0).getTime() }, { t: new Date(2026, 2, 9, 0, 10).getTime() }];
  assert.deepEqual(
    byDay(items, (i) => i.t, now).map((g) => [g.title, g.items.length]),
    [
      ["Today", 1],
      ["Yesterday", 1],
      ["2 days ago", 1],
    ],
  );
});

test("the autumn change, a 25-hour day, doesn't push yesterday into today", () => {
  const now = new Date(2026, 10, 2, 0, 30);
  const items = [{ t: new Date(2026, 10, 1, 0, 15).getTime() }, { t: new Date(2026, 9, 31, 23, 50).getTime() }];
  assert.deepEqual(
    byDay(items, (i) => i.t, now).map((g) => g.title),
    ["Yesterday", "2 days ago"],
  );
});
