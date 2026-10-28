import assert from "node:assert/strict";
import { test } from "node:test";
import { awakeClock, sleepAfterMs, SLEEP_POLICY } from "./sleepPolicy.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test("a background tab sleeps after Chrome's Memory Saver default of 4 h, a recent one after 8 h", () => {
  assert.equal(sleepAfterMs(SLEEP_POLICY, "normal", false), 4 * HOUR);
  assert.equal(sleepAfterMs(SLEEP_POLICY, "normal", true), 8 * HOUR);
});

test("memory pressure shortens the wait but never sleeps a tab hidden under 10 min", () => {
  assert.equal(sleepAfterMs(SLEEP_POLICY, "warning", false), HOUR);
  assert.equal(sleepAfterMs(SLEEP_POLICY, "warning", true), 8 * HOUR, "the recent tabs keep their time under a warning");
  assert.equal(sleepAfterMs(SLEEP_POLICY, "critical", false), 10 * MINUTE);
  assert.equal(sleepAfterMs(SLEEP_POLICY, "critical", true), 10 * MINUTE);
  for (const pressure of ["normal", "warning", "critical"])
    for (const recent of [false, true]) assert.ok(sleepAfterMs(SLEEP_POLICY, pressure, recent) >= 10 * MINUTE);
});

test("the awake clock skips the time the Mac slept", () => {
  let now = 1_000_000;
  const clock = awakeClock(() => now, 5 * MINUTE);
  now += 30_000;
  assert.equal(clock.read(), 30_000);
  now += 8 * HOUR;
  assert.equal(clock.read(), 30_000 + 5 * MINUTE, "a night asleep counts as one capped step");
  now -= 10 * MINUTE;
  assert.equal(clock.read(), 30_000 + 5 * MINUTE, "a clock set back doesn't run it backwards");
  now += 30_000;
  assert.equal(clock.read(), 60_000 + 5 * MINUTE);
  assert.equal(clock.advance(HOUR), 60_000 + 5 * MINUTE + HOUR);
});
