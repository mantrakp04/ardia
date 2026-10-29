import assert from "node:assert/strict";
import { test } from "node:test";
const { durationMinutes, durationParts, durationTitle, MAX_DURATION_MINUTES } = await import("./time.ts");

test("a duration in minutes reads in the largest unit that holds it exactly", () => {
  for (const [minutes, amount, unit] of [[30, 30, "minutes"], [90, 90, "minutes"], [60, 1, "hours"], [36 * 60, 36, "hours"], [1440, 1, "days"], [7 * 1440, 7, "days"]]) {
    assert.deepEqual(durationParts(minutes), { amount, unit });
  }
});

test("duration titles say one minute, hour or day in the singular", () => {
  for (const [minutes, title] of [[1, "1 minute"], [45, "45 minutes"], [60, "1 hour"], [720, "12 hours"], [1440, "1 day"], [2880, "2 days"], [43200, "30 days"]]) {
    assert.equal(durationTitle(minutes), title);
  }
});

test("a typed amount becomes whole minutes, and nothing at or below zero or past a year counts", () => {
  assert.equal(durationMinutes("30", "minutes"), 30);
  assert.equal(durationMinutes(" 2 ", "hours"), 120);
  assert.equal(durationMinutes("1.5", "hours"), 90);
  assert.equal(durationMinutes("3", "days"), 3 * 1440);
  assert.equal(durationMinutes("365", "days"), MAX_DURATION_MINUTES);
  for (const [amount, unit] of [["0", "minutes"], ["0.2", "minutes"], ["-5", "minutes"], ["", "hours"], ["abc", "days"], ["1e3", "minutes"], ["366", "days"]]) {
    assert.equal(durationMinutes(amount, unit), null, `${amount} ${unit}`);
  }
});
