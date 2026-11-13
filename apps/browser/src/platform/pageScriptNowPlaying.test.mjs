import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const pick = (pattern, name) => {
  const source = script.match(pattern)?.[0];
  assert.ok(source, `page_script.js defines ${name}`);
  return source;
};
const helpers = [
  pick(/const POSITION_DRIFT_SECONDS = .*;\n/, "POSITION_DRIFT_SECONDS"),
  pick(/const anchorPosition = .*;\n/, "anchorPosition"),
  pick(/const advanceAnchor = \([\s\S]*?\n {2}\};\n/, "advanceAnchor"),
  pick(/const expectedPosition = .*;\n/, "expectedPosition"),
  pick(/const positionDrifted = .*;\n/, "positionDrifted"),
].join("");
const { anchorPosition, advanceAnchor, positionDrifted } = new Function(`${helpers} return { anchorPosition, advanceAnchor, positionDrifted };`)();
const positionAfter = (state, steps) => steps.reduce((anchor, [playing, now]) => advanceAnchor(anchor, playing, now), anchorPosition(state, 0)).position;

const sent = (overrides = {}) => ({ playbackState: "playing", position: 1, playbackRate: 1, timestamp: 0, ...overrides });
const at = (position, overrides = {}) => ({ playbackState: "playing", position, playbackRate: 1, ...overrides });

test("a looping video back at its start is resent though nothing else about it changed", () => {
  assert.equal(positionDrifted(sent(), at(1), 12_000), true, "the app thinks 13 s, the page says 1 s");
});

test("seeking back is resent, a position the app would extrapolate anyway is not", () => {
  assert.equal(positionDrifted(sent({ position: 40 }), at(10), 5_000), true);
  assert.equal(positionDrifted(sent({ position: 40 }), at(45.4), 5_000), false);
  assert.equal(positionDrifted(sent({ position: 40, playbackRate: 2 }), at(50), 5_000), false, "extrapolated at its rate");
});

test("a paused report is expected to stay put", () => {
  assert.equal(positionDrifted(sent({ playbackState: "paused", position: 30 }), at(30, { playbackState: "paused" }), 60_000), false);
  assert.equal(positionDrifted(sent({ playbackState: "paused", position: 30 }), at(0, { playbackState: "paused" }), 60_000), true);
});

test("the first report and a cleared session never count as drift", () => {
  assert.equal(positionDrifted(null, at(5), 1_000), false);
  assert.equal(positionDrifted(sent(), null, 1_000), false);
});

test("a site's setPositionState advances only while playing, like Chrome's own media session", () => {
  const state = { position: 30, duration: 200, playbackRate: 1 };
  assert.equal(positionAfter(state, [[true, 10_000]]), 40);
  assert.equal(positionAfter(state, [[false, 10_000]]), 30, "paused since it was set: where it was set");
  assert.equal(positionAfter(state, [[true, 0], [false, 10_000], [false, 60_000], [true, 60_000]]), 40, "played 10 s, then paused 50 s: 10 s on");
  assert.equal(positionAfter(state, [[false, 0], [true, 50_000], [true, 60_000]]), 40, "paused 50 s, then played 10 s");
  assert.equal(positionAfter({ ...state, playbackRate: 0.5 }, [[true, 10_000]]), 35);
  assert.equal(positionAfter(state, [[true, 1_000_000]]), 200, "never past its duration");
  assert.equal(positionAfter({ position: 30 }, [[true, 10_000]]), 40, "no duration and no rate: 1x, unclamped");
});

test("a site that set its position once and then went quiet isn't resent as if it had jumped back", () => {
  const state = { position: 30, duration: 200, playbackRate: 1 };
  const first = sent({ position: positionAfter(state, [[true, 0]]), timestamp: 0 });
  assert.equal(positionDrifted(first, at(positionAfter(state, [[true, 0], [true, 20_000]])), 20_000), false);
});
