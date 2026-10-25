import assert from "node:assert/strict";
import { test } from "node:test";
import { PULL_OPENS_AT, pullProgress, RUBBER_FULL_PULL, trackPull } from "./pullDecision.ts";

const run = (steps) => {
  let track = { pulling: false, held: null };
  const opened = [];
  for (const [progress, down] of steps) {
    const step = trackPull(track, progress, down);
    track = { pulling: step.pulling, held: step.held };
    if (step.open !== null) opened.push(step.open);
  }
  return { track, opened };
};

test("progress is the pull past the first space as a share of a full pull", () => {
  assert.equal(pullProgress(0), 0);
  assert.equal(pullProgress(-RUBBER_FULL_PULL / 2), 0.5);
  assert.equal(pullProgress(-1), 1);
  assert.equal(pullProgress(0.3), 0);
});

test("letting go past the threshold opens the Library, at the release", () => {
  const { opened } = run([[0.1, true], [0.5, true], [0.6, true], [0.5, false], [0.2, false]]);
  assert.deepEqual(opened, [0.6]);
});

test("pulling past the threshold and back before letting go doesn't open it", () => {
  const { opened, track } = run([[0.2, true], [0.7, true], [0.3, true], [0.25, false], [0, false]]);
  assert.deepEqual(opened, []);
  assert.equal(track.pulling, true, "still following the spring back until the pager settles");
});

test("the spring back after a swipe isn't mistaken for a pull", () => {
  const { opened, track } = run([[0.8, false], [0.5, false], [0, false]]);
  assert.deepEqual(opened, []);
  assert.equal(track.pulling, false);
});

test("a new gesture starts from nothing, not the last one's pull", () => {
  let { track } = run([[0.9, true]]);
  track = { pulling: false, held: null };
  const step = trackPull(track, 0.1, false);
  assert.equal(step.open, null);
  assert.ok(PULL_OPENS_AT > 0.1);
});
