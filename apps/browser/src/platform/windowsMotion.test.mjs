import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelFrame, followMotion, forgetAnimation, noteAnimation, onMotionBurst, requestFrame } from "../../../../packages/expo-windows/src/animation/motion.ts";

const reported = [];
console.error = (...values) => void reported.push(values);

const turns = (count) => new Promise((resolve) => (function next(left) { left ? requestFrame(() => next(left - 1)) : resolve(); })(count));

test("a frame callback that throws does not drop the ones after it", async () => {
  const ran = [];
  reported.length = 0;
  requestFrame(() => {
    throw new Error("first frame fails");
  });
  requestFrame(() => ran.push("second"));
  await turns(1);
  assert.deepEqual(ran, ["second"]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0][1].message, "first frame fails");
});

test("a callback cancelled by an earlier one in the same turn does not run", async () => {
  const ran = [];
  let later = 0;
  requestFrame(() => {
    ran.push("first");
    cancelFrame(later);
  });
  later = requestFrame(() => ran.push("cancelled"));
  await turns(2);
  assert.deepEqual(ran, ["first"]);
});

test("frames are paced about a sixtieth of a second apart", async () => {
  const started = performance.now();
  await turns(12);
  const each = (performance.now() - started) / 12;
  assert.ok(each > 12 && each < 40, `${each.toFixed(1)} ms a frame`);
});

test("followers run every frame while an animation runs, a burst is reported when it ends, and the clock stops", async () => {
  let follows = 0;
  const bursts = [];
  const unfollow = followMotion(() => follows++);
  const unlisten = onMotionBurst((burst) => bursts.push(burst));
  const animation = { __active: true };
  noteAnimation(animation);
  await turns(6);
  assert.ok(follows >= 5, `${follows} follows in 6 frames`);
  assert.equal(bursts.length, 0);
  forgetAnimation(animation);
  await turns(2);
  assert.equal(bursts.length, 1);
  assert.ok(bursts[0].frames >= 6 && bursts[0].milliseconds >= 60, JSON.stringify(bursts[0]));
  const after = follows;
  await turns(4);
  assert.equal(follows, after);
  unfollow();
  unlisten();
});

test("a follower that throws leaves the clock able to start again", async () => {
  reported.length = 0;
  const unfollow = followMotion(() => {
    throw new Error("follower fails");
  });
  const first = { __active: true };
  noteAnimation(first);
  await turns(2);
  forgetAnimation(first);
  await turns(2);
  unfollow();
  assert.ok(reported.length >= 1);
  let follows = 0;
  const unfollowCount = followMotion(() => follows++);
  const second = { __active: true };
  noteAnimation(second);
  await turns(3);
  forgetAnimation(second);
  await turns(2);
  unfollowCount();
  assert.ok(follows >= 2, `${follows} follows after a failed follower`);
});
