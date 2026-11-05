import assert from "node:assert/strict";
import { test } from "node:test";
import { singleFlight } from "./singleFlight.ts";
import { withDeadline } from "./deadline.ts";

test("calls during a pass share it and run one more pass after it", async () => {
  let passes = 0;
  let release;
  const run = singleFlight(async () => {
    passes++;
    if (passes === 1) await new Promise((r) => (release = r));
  });
  const first = run();
  const second = run();
  run();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(passes, 2);
  await run();
  assert.equal(passes, 3);
});

test("a pass can ask for another, and stops repeating once keepGoing says no", async () => {
  let passes = 0;
  let on = true;
  await singleFlight(
    async (flight) => {
      passes++;
      if (passes === 2) on = false;
      flight.repeat();
    },
    () => on,
  )();
  assert.equal(passes, 2);
});

test("a failed pass rejects its callers and the next call starts afresh", async () => {
  let fail = true;
  const run = singleFlight(async () => {
    if (fail) throw new Error("boom");
  });
  await assert.rejects(run());
  fail = false;
  await run();
});

test("a deadline returns the fallback when the work is slow and the result when it isn't", async () => {
  assert.equal(await withDeadline(new Promise(() => {}), 5, "late"), "late");
  assert.equal(await withDeadline(Promise.resolve("on time"), 1000, "late"), "on time");
});
