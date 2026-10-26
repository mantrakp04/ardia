import test from "node:test";
import assert from "node:assert/strict";
import { retainedBriefDates } from "./briefRetention.ts";

test("keeps a rolling seven local days as the next week arrives", () => {
  const dates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
  assert.deepEqual(retainedBriefDates(dates, new Date(2026, 9, 25, 8)), [...dates].reverse());
  assert.deepEqual(retainedBriefDates([...dates, "2026-10-26"], new Date(2026, 9, 26, 8)), [...dates.slice(1), "2026-10-26"].reverse());
  assert.deepEqual(retainedBriefDates([...dates, "2026-10-26", "2026-10-27"], new Date(2026, 9, 27, 8)), [...dates.slice(2), "2026-10-26", "2026-10-27"].reverse());
});

test("rejects future, invalid, and duplicate dates", () => {
  assert.deepEqual(retainedBriefDates(["2026-10-24", "2026-10-24", "2026-10-32", "2026-10-25"], new Date(2026, 9, 24, 8)), ["2026-10-24"]);
});
