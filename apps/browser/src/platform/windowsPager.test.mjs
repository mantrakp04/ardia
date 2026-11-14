import assert from "node:assert/strict";
import { test } from "node:test";
import { PagerRegistry, REST_DISPLACEMENT } from "../../../../packages/expo-windows/src/pager/pager.ts";

const FRAME_MS = 1000 / 60;
const MAC_SETTLE_ONE_PAGE_MS = 330;

function harness({ reduced = false } = {}) {
  let time = 0;
  let frames = new Map();
  let lastId = 0;
  let motions = 0;
  const registry = new PagerRegistry({
    now: () => time,
    requestFrame: (frame) => {
      frames.set(++lastId, frame);
      return lastId;
    },
    cancelFrame: (id) => void frames.delete(id),
    reducedMotion: () => reduced,
    startMotion: () => {
      motions += 1;
      return () => void (motions -= 1);
    },
  });
  const positions = [];
  const states = [];
  const area = { position: (p) => (positions.push(p), true), state: (e) => states.push(e) };
  const tick = (ms = FRAME_MS) => {
    time += ms;
    const due = [...frames.values()];
    frames.clear();
    for (const frame of due) frame();
    return due.length > 0;
  };
  const runToRest = (ms = FRAME_MS, limit = 600) => {
    let count = 0;
    while (frames.size && count < limit) tick(ms), (count += 1);
    return count;
  };
  return { registry, positions, states, area, tick, runToRest, elapsed: () => time, moving: () => frames.size > 0, motions: () => motions };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function configured(h, { selected = 0, count = 3, order = ["a", "b", "c"] } = {}) {
  const pager = h.registry.named("w");
  pager.attach(h.area);
  pager.configure({ selected, count, ack: 0, width: 200, order });
  return pager;
}

test("a switch settles on the target within the Mac's time and never overshoots", async () => {
  const h = harness();
  const pager = configured(h);
  const start = h.positions.length;
  assert.equal(pager.switchTo(1), true);
  const startedAt = h.elapsed();
  h.runToRest();
  const took = h.elapsed() - startedAt;
  const moved = h.positions.slice(start);
  assert.ok(moved.length > 10, `only ${moved.length} frames`);
  assert.ok(took <= MAC_SETTLE_ONE_PAGE_MS + FRAME_MS, `took ${took} ms`);
  assert.equal(moved.at(-1), 1);
  for (let i = 1; i < moved.length; i += 1) assert.ok(moved[i] >= moved[i - 1], `went back at frame ${i}`);
  assert.ok(moved.every((p) => p <= 1), "overshot");
  assert.ok(Math.abs(moved.at(-2) - 1) < REST_DISPLACEMENT * 2);
  assert.equal(h.registry.snapshot("w").phase, "idle");
  assert.equal(h.motions(), 0);
  await flush();
  assert.deepEqual(h.states.map((s) => s.phase), ["selected", "settled"]);
  assert.equal(h.states[1].profileId, "b");
  assert.equal(h.states[1].selected, 1);
});

test("a slow frame does not slow the motion, and a long stall is clamped", () => {
  const steady = harness();
  configured(steady).switchTo(2);
  steady.runToRest();
  const slow = harness();
  configured(slow).switchTo(2);
  slow.runToRest(FRAME_MS * 3);
  assert.ok(Math.abs(slow.elapsed() - steady.elapsed()) <= FRAME_MS * 3, `${slow.elapsed()} vs ${steady.elapsed()}`);
  const stalled = harness();
  configured(stalled).switchTo(2);
  stalled.tick(5000);
  assert.ok(stalled.moving(), "a five second stall jumped to the end");
  assert.ok(stalled.positions.at(-1) > 0 && stalled.positions.at(-1) < 2);
});

test("a new request mid-flight retargets from where the page is, without a jump", () => {
  const h = harness();
  const pager = configured(h, { count: 4, order: ["a", "b", "c", "d"] });
  pager.switchTo(2);
  for (let i = 0; i < 6; i += 1) h.tick();
  const before = h.positions.at(-1);
  const step = before - h.positions.at(-2);
  assert.ok(before > 0.3 && before < 1.9, `at ${before}`);
  pager.switchTo(0);
  h.tick();
  const after = h.positions.at(-1);
  assert.ok(Math.abs(after - before) <= Math.abs(step) * 2 + 0.05, `jumped from ${before} to ${after}`);
  h.runToRest();
  assert.equal(h.positions.at(-1), 0);
  assert.equal(h.registry.snapshot("w").selected, 0);
});

test("targets clamp to the page range and steps stop at the ends unless they wrap", () => {
  const h = harness();
  const pager = configured(h);
  pager.switchTo(9);
  h.runToRest();
  assert.equal(h.registry.snapshot("w").selected, 2);
  assert.equal(h.positions.at(-1), 2);
  pager.switchTo(-4);
  h.runToRest();
  assert.equal(h.registry.snapshot("w").selected, 0);
  assert.equal(pager.step(-1, false), true);
  assert.equal(h.moving(), false);
  assert.equal(pager.step(-1, true), true);
  h.runToRest();
  assert.equal(h.registry.snapshot("w").selected, 2);
});

test("the sequence rises on every selection and every settle", async () => {
  const h = harness();
  const pager = configured(h);
  const first = h.registry.snapshot("w").sequence;
  pager.switchTo(1);
  const selected = h.registry.snapshot("w");
  assert.ok(selected.sequence > first);
  assert.equal(selected.selectionSequence, selected.sequence);
  h.runToRest();
  const settled = h.registry.snapshot("w").sequence;
  assert.ok(settled > selected.sequence);
  pager.switchTo(2);
  h.runToRest();
  await flush();
  const sequences = h.states.map((s) => s.sequence);
  assert.deepEqual([...sequences].sort((a, b) => a - b), sequences);
  assert.equal(new Set(sequences).size, sequences.length);
});

test("an unconfigured or missing pager refuses, so the app falls back", () => {
  const h = harness();
  assert.equal(h.registry.existing("w"), null);
  const pager = h.registry.named("w");
  assert.equal(pager.switchTo(1), false);
  assert.equal(pager.step(1, false), false);
  assert.equal(pager.select("a", ["a"]), false);
});

test("an outside selection jumps at once and answers with a higher sequence", async () => {
  const h = harness();
  const pager = configured(h);
  const before = h.registry.snapshot("w").sequence;
  assert.equal(pager.select("c", ["a", "b", "c"]), true);
  assert.equal(h.positions.at(-1), 2);
  assert.equal(h.moving(), false);
  const snapshot = h.registry.snapshot("w");
  assert.ok(snapshot.sequence > before);
  assert.equal(snapshot.profileId, "c");
  assert.equal(pager.select("z", ["a", "b", "c"]), false);
  await flush();
  assert.deepEqual(h.states.map((s) => s.phase), ["selected"]);
});

test("props catch up only once the app has acknowledged the pager's own selection", () => {
  const h = harness();
  const pager = configured(h);
  pager.switchTo(1);
  h.runToRest();
  const { selectionSequence } = h.registry.snapshot("w");
  pager.configure({ selected: 0, count: 3, ack: selectionSequence - 1, width: 200, order: ["a", "b", "c"] });
  assert.equal(h.registry.snapshot("w").selected, 1);
  pager.configure({ selected: 2, count: 3, ack: selectionSequence, width: 200, order: ["a", "b", "c"] });
  assert.equal(h.registry.snapshot("w").selected, 2);
  assert.equal(h.positions.at(-1), 2);
});

test("with animations off the pager lands at once and still reports the settle", async () => {
  const h = harness({ reduced: true });
  const pager = configured(h);
  assert.equal(pager.switchTo(2), true);
  assert.equal(h.moving(), false);
  assert.equal(h.positions.at(-1), 2);
  await flush();
  assert.deepEqual(h.states.map((s) => s.phase), ["selected", "settled"]);
});

test("position goes to one area, state to all, and the last area out forgets the pager", async () => {
  const h = harness();
  const pager = configured(h);
  const second = { positions: [], states: [] };
  const secondArea = { position: (p) => (second.positions.push(p), true), state: (e) => second.states.push(e) };
  pager.attach(secondArea);
  assert.deepEqual(second.positions, [0]);
  pager.switchTo(1);
  h.runToRest();
  await flush();
  assert.equal(second.positions.length, 1);
  assert.equal(second.states.length, h.states.length);
  pager.detach(h.area);
  assert.equal(h.registry.existing("w"), pager);
  pager.switchTo(0);
  h.tick();
  assert.ok(second.positions.length > 1);
  pager.detach(secondArea);
  assert.equal(h.registry.existing("w"), null);
  assert.equal(h.registry.snapshot("w"), null);
  assert.equal(h.moving(), false);
});
