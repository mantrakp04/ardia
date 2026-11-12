import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
await import("../test-native/index.ts");
const { everySlowly, reschedule, slowTimersForTests } = await import("./slowTimers.ts");

const B = 1_000_000_020_000;
let now = B + 7_000;
const lab = slowTimersForTests(() => now);
const at = (t) => {
  now = t;
  lab.fire();
};

test("jobs of different periods share one timer on a common grid", () => {
  lab.clear();
  const ran = [];
  const stopA = everySlowly({ every: 30_000, run: () => ran.push("a") });
  const stopB = everySlowly({ every: 60_000, run: () => ran.push("b") });
  const stopC = everySlowly({ every: 10_000, run: () => ran.push("c") });
  assert.equal(lab.pending(), B + 10_000);
  at(B + 10_000);
  at(B + 20_000);
  assert.deepEqual(ran, ["c", "c"]);
  at(B + 30_000);
  assert.deepEqual(ran.slice(2).sort(), ["a", "c"]);
  at(B + 40_000);
  at(B + 50_000);
  at(B + 60_000);
  assert.deepEqual(ran.slice(6).sort(), ["a", "b", "c"]);
  stopA();
  stopB();
  stopC();
  assert.equal(lab.pending(), null);
});

test("a job with nothing to do schedules no timer until its watch says so", () => {
  lab.clear();
  let wanted = false;
  let notify = () => {};
  const ran = [];
  const stop = everySlowly({
    every: 30_000,
    run: () => ran.push(now),
    needed: () => wanted,
    watch: (changed) => ((notify = changed), () => (notify = () => {})),
  });
  assert.equal(lab.pending(), null);
  wanted = true;
  notify();
  assert.equal(lab.pending(), B + 90_000);
  at(B + 90_000);
  assert.deepEqual(ran, [B + 90_000]);
  wanted = false;
  reschedule();
  assert.equal(lab.pending(), null);
  stop();
});

test("a timer that fires late runs the job once and keeps to the grid", () => {
  lab.clear();
  const ran = [];
  const stop = everySlowly({ every: 30_000, run: () => ran.push(now) });
  at(B + 157_000);
  assert.equal(ran.length, 1);
  assert.equal(lab.pending(), B + 180_000);
  stop();
});

test("a job whose run makes a watch reschedule does not skip the other jobs due with it", () => {
  lab.clear();
  const ran = [];
  let notify = () => {};
  const stopA = everySlowly({
    every: 30_000,
    run: () => {
      ran.push("a");
      notify();
    },
    watch: (changed) => ((notify = changed), () => (notify = () => {})),
  });
  const stopB = everySlowly({ every: 60_000, run: () => ran.push("b") });
  const stopC = everySlowly({ every: 1_800_000, run: () => ran.push("c") });
  at(B + 1_800_000);
  assert.deepEqual(ran.sort(), ["a", "b", "c"]);
  assert.equal(lab.pending(), B + 1_830_000);
  stopA();
  stopB();
  stopC();
});

test("a watch that reschedules while a job is overdue keeps that job due", () => {
  lab.clear();
  const ran = [];
  let notify = () => {};
  const stopA = everySlowly({ every: 30_000, run: () => ran.push(now) });
  const stopW = everySlowly({
    every: 60_000,
    run: () => {},
    needed: () => false,
    watch: (changed) => ((notify = changed), () => (notify = () => {})),
  });
  const due = lab.pending();
  now = due + 65_000;
  notify();
  assert.equal(lab.pending(), due);
  lab.fire();
  assert.deepEqual(ran, [due + 65_000]);
  stopA();
  stopW();
});

test("a job that becomes needed after its slot passed waits for its next slot", () => {
  lab.clear();
  const ran = [];
  let wanted = false;
  let notify = () => {};
  const stop = everySlowly({
    every: 30_000,
    run: () => ran.push(now),
    needed: () => wanted,
    watch: (changed) => ((notify = changed), () => (notify = () => {})),
  });
  now = B + 2_000_000;
  wanted = true;
  notify();
  assert.equal(lab.pending(), B + 2_010_000);
  stop();
});

test("a wake just before the slot runs the job once and moves on to the next slot", () => {
  lab.clear();
  const ran = [];
  const stop = everySlowly({ every: 30_000, run: () => ran.push(now) });
  const slot = lab.pending();
  at(slot - 20);
  assert.equal(ran.length, 1);
  assert.equal(lab.pending(), slot + 30_000);
  stop();
});

test("a dormant job a callback wakes in the middle of a batch waits for its own slot", () => {
  lab.clear();
  const ran = [];
  let wanted = false;
  let notify = () => {};
  const stopD = everySlowly({
    every: 60_000,
    run: () => ran.push("d"),
    needed: () => wanted,
    watch: (changed) => ((notify = changed), () => (notify = () => {})),
  });
  const stopA = everySlowly({
    every: 30_000,
    run: () => {
      ran.push("a");
      wanted = true;
      notify();
    },
  });
  const slot = lab.pending();
  at(slot + 60_000);
  assert.deepEqual(ran, ["a"]);
  assert.ok(lab.pending() > slot + 60_000);
  stopA();
  stopD();
});
