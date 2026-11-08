import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const shell = new URL("../../../../packages/shell/ios/", import.meta.url);
const read = (name) => readFileSync(new URL(name, shell), "utf8");

const between = (source, from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return source.slice(start, end);
};

const count = (source, needle) => source.split(needle).length - 1;

test("WindowMove.follow records the pointer on each drag event and places the window only from the pacer", () => {
  const source = read("WindowMove.swift");
  const follow = between(source, "static func follow(", "private static let gestureEvents");
  const pacer = follow.indexOf("WindowMovePacer(window: window)");
  const loop = follow.indexOf("while window.isVisible");
  assert.ok(pacer >= 0, "follow places the window itself on every drag event instead of from a WindowMovePacer, so placement follows event arrival and not the display's refresh");
  assert.ok(pacer < loop, "the pacer is made before the event loop starts");
  assert.equal(count(source, "setFrameOrigin"), 1, "one setFrameOrigin in WindowMove, the pacer's placement");
  const placement = follow.indexOf("setFrameOrigin");
  assert.ok(placement > pacer && placement < loop, "setFrameOrigin is the pacer's placement, not part of the event loop");
  const events = follow.slice(loop);
  assert.ok(!events.includes("setFrameOrigin") && !events.includes("move(to"), "the event loop never places the window");
  assert.match(events, /pacer\.moved\(to: screenPoint\(latest\)\)/, "a drag event only hands its pointer to the pacer");
  assert.match(events, /pacer\.finish\(at: screenPoint\(next\)\)/, "the mouse-up pointer is placed at once");
});

test("WindowMove.follow flushes the last pointer while the window still holds its placement, whichever way the drag ends", () => {
  const follow = between(read("WindowMove.swift"), "static func follow(", "private static let gestureEvents");
  const drain = follow.indexOf("drainsUntil");
  const flush = follow.indexOf("defer { pacer.finish(at: nil) }");
  assert.ok(flush >= 0, "every exit of follow finishes the pacer");
  assert.ok(drain >= 0 && flush > drain, "the pacer's defer comes after the one that clears `moving`, so it runs first");
});

test("WindowMove.follow places a pointer the display link left waiting when no drag event follows it", () => {
  const source = read("WindowMove.swift");
  const follow = between(source, "static func follow(", "private static let gestureEvents");
  const loop = follow.slice(follow.indexOf("while window.isVisible"));
  assert.match(loop, /nextGestureEvent\(waiting: pacer\.untilStall\)/, "the wait for the next event ends when a held pointer's stall is due");
  const idle = between(loop, "guard var next", "var latest");
  assert.match(idle, /pacer\.idle\(\)/, "an event wait that ends with no event places the held pointer once the link has stalled");
  const wait = between(source, "private static func nextGestureEvent(", "private static func place(");
  assert.match(wait, /min\(0\.1, stall \?\? 0\.1\)/, "the wait is the stall deadline when one is held, and the usual 0.1 s otherwise");
});

test("WindowMovePacer source is wired to the window's display link at the display's rate, with the pointer fallback when the link stalls", () => {
  const pacer = read("WindowMovePacer.swift");
  assert.match(pacer, /window\.displayLink\(target: self, selector: #selector\(frame\(_:\)\)\)/, "the link follows the window's own display");
  assert.match(pacer, /link\.add\(to: \.main, forMode: \.common\)/, "the link fires inside the event-tracking loop");
  assert.match(pacer, /maximumFramesPerSecond/, "the link asks for the fastest display's rate");
  assert.match(pacer, /preferredFrameRateRange = CAFrameRateRange\(minimum: 60, maximum: fps, preferred: fps\)/);
  assert.match(pacer, /link\?\.invalidate\(\)/, "the link, which retains the pacer, ends with the drag");
  assert.match(pacer, /pacing\.frame\(now: CACurrentMediaTime\(\)\)/, "a frame places the newest pointer");
  assert.match(pacer, /pacing\.moved\(to: pointer, now: CACurrentMediaTime\(\)\)/, "an event places at once only when the link stalled");
  assert.match(pacer, /pacing\.idle\(now: CACurrentMediaTime\(\)\)/, "a quiet wait places the held pointer once the link has stalled");
  assert.match(pacer, /pacing\.untilStall\(now: CACurrentMediaTime\(\)\)/, "the loop learns when a held pointer's stall is due");
  assert.ok(!pacer.includes("setFrameOrigin"), "the pacer places through the closure it is given");
});

test("WindowMoveProbe.drag source reports placements per frame and the spread of the gaps between placements", () => {
  const probe = read("WindowMoveProbe.swift");
  assert.match(probe, /WindowMove\.moveTimes = \[\]/);
  assert.match(probe, /WindowMove\.frameTimes = \[\]/);
  assert.match(probe, /"pacing": pacingReport\(from: began, to: ended\)/);
  for (const key of ["placements", "frames", "placementsPerFrame", "placementGapMs", "variance"]) {
    assert.ok(probe.includes(`"${key}"`), `the probe reports ${key}`);
  }
});
