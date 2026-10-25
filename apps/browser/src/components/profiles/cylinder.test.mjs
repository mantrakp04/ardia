import assert from "node:assert/strict";
import { test } from "node:test";
const { CYLINDER_PITCH, CYLINDER_RADIUS, CYLINDER_THETA, cylinderPoint, cylinderPosition, cylinderSamples } = await import("./cylinder.ts");

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test("the geometry constants agree with each other", () => {
  assert.equal(CYLINDER_PITCH, 36);
  assert.equal(CYLINDER_RADIUS, 170);
  assert.equal(CYLINDER_THETA, CYLINDER_PITCH / CYLINDER_RADIUS);
});

test("a slot under the centre sits flat on the ruler", () => {
  for (const slot of [0, 1, 3, 12]) {
    const point = cylinderPoint(slot, slot);
    assert.equal(point.x, 0);
    assert.equal(point.scale, 1);
    assert.equal(point.angle, 0);
    assert.equal(point.opacity, 1);
  }
});

test("equal distances either side of the centre mirror each other", () => {
  for (const distance of [0.5, 1, 3, 5.5]) {
    const right = cylinderPoint(3 + distance, 3);
    const left = cylinderPoint(3 - distance, 3);
    near(right.x, -left.x, 1e-9, "x mirrors");
    near(right.angle, -left.angle, 1e-12, "angle mirrors");
    near(right.scale, left.scale, 1e-12, "scale mirrors");
    near(right.opacity, left.opacity, 1e-12, "opacity mirrors");
  }
});

test("the ruler compresses toward the edges", () => {
  const three = cylinderPoint(3, 0);
  assert.ok(Math.abs(three.x) < 3 * CYLINDER_PITCH, String(three.x));
  assert.ok(Math.abs(cylinderPoint(5, 0).x) < 5 * CYLINDER_PITCH);
  assert.ok(Math.abs(cylinderPoint(1, 0).x) < CYLINDER_PITCH);
});

test("one slot near the centre moves by almost exactly the pitch", () => {
  const step = cylinderPoint(1, 0).x - cylinderPoint(0, 0).x;
  assert.ok(Math.abs(step - CYLINDER_PITCH) / CYLINDER_PITCH < 0.02, String(step));
});

test("the ruler is fully opaque in the middle and gone past the edge", () => {
  const centre = cylinderPoint(0, 0);
  const atFive = cylinderPoint(5, 0);
  const atSix = cylinderPoint(6, 0);
  const atSeven = cylinderPoint(7, 0);
  assert.equal(centre.opacity, 1);
  assert.equal(atFive.opacity, 1);
  assert.ok(atSix.opacity > 0 && atSix.opacity < 1, String(atSix.opacity));
  assert.equal(atSeven.opacity, 0);
  assert.equal(cylinderPoint(40, 0).opacity, 0);
  assert.ok(atSix.opacity < atFive.opacity);
});

test("cylinderPosition inverts the ruler mapping", () => {
  for (const index of [0, 1, 4, 9]) {
    for (const position of [0, 0.5, 1.25, 2, 3.75]) {
      near(cylinderPosition(index, (index - position) * CYLINDER_PITCH), position, 1e-9, "position round trip");
    }
  }
  assert.equal(cylinderPosition(2, CYLINDER_PITCH), 1);
  assert.equal(cylinderPosition(2, 0), 2);
  near(cylinderPosition(3, cylinderPoint(3, 2.5).x), 2.5, 5e-3, "near the centre the ruler reads back");
});

test("samples include both ends exactly even when the step does not divide the span", () => {
  const samples = cylinderSamples(0, 0, 1, 0.3);
  assert.equal(samples.input[0], 0);
  assert.equal(samples.input[samples.input.length - 1], 1);
  assert.equal(samples.input.length, 5);
  for (let i = 1; i < samples.input.length; i += 1) assert.ok(samples.input[i] > samples.input[i - 1]);
  assert.equal(samples.dx.length, samples.input.length);
  assert.equal(samples.angle.length, samples.input.length);
  assert.equal(samples.opacity.length, samples.input.length);
});

test("samples walk backwards when asked", () => {
  const samples = cylinderSamples(0, 2, -1, 0.4);
  assert.equal(samples.input[0], 2);
  assert.equal(samples.input[samples.input.length - 1], -1);
  for (let i = 1; i < samples.input.length; i += 1) assert.ok(samples.input[i] < samples.input[i - 1]);
});

test("a single point sample keeps the endpoints without duplicating", () => {
  const samples = cylinderSamples(4, 4, 4);
  assert.deepEqual(samples.input, [4]);
  assert.equal(samples.dx[0], 0);
  assert.equal(samples.angle[0], "0.0deg");
  assert.equal(samples.opacity[0], 1);
});

test("samples match the point geometry and the angle strings are degrees", () => {
  const samples = cylinderSamples(2, -2, 2);
  for (let i = 0; i < samples.input.length; i += 1) {
    const point = cylinderPoint(2, samples.input[i]);
    near(samples.dx[i], point.x, 1e-12, "dx matches");
    near(samples.opacity[i], point.opacity, 1e-12, "opacity matches");
    assert.match(samples.angle[i], /^-?\d+\.\ddeg$/);
  }
  assert.deepEqual(cylinderSamples(0, 1, 1).angle, ["-12.1deg"]);
  assert.deepEqual(cylinderSamples(0, -1, -1).angle, ["12.1deg"]);
});

test("one side of the ruler moves faster at the centre and flattens outward", () => {
  const samples = cylinderSamples(0, 0, 7);
  const distances = samples.dx.map((value) => Math.abs(value));
  for (let i = 1; i < distances.length; i += 1) assert.ok(distances[i] > distances[i - 1]);
  const steps = [];
  for (let i = 1; i < distances.length; i += 1) steps.push(distances[i] - distances[i - 1]);
  for (let i = 1; i < steps.length; i += 1) assert.ok(steps[i] < steps[i - 1], `${steps[i - 1]} then ${steps[i]}`);
});

test("large slots and positions stay finite", () => {
  for (const [slot, position] of [
    [1e6, -1e6],
    [-1e9, 1e9],
    [0, 1e12],
    [123456789, 987654321],
  ]) {
    const point = cylinderPoint(slot, position);
    assert.ok(Number.isFinite(point.x), "x");
    assert.ok(Number.isFinite(point.scale), "scale");
    assert.ok(Number.isFinite(point.angle), "angle");
    assert.ok(Number.isFinite(point.opacity), "opacity");
    assert.ok(point.scale >= 0 && point.scale <= 1);
    assert.ok(point.opacity >= 0 && point.opacity <= 1);
  }
  assert.ok(Number.isFinite(cylinderPosition(1e9, 1e12)));
  const samples = cylinderSamples(1e6, 1e6, 1e6);
  assert.equal(samples.input.length, 1);
  assert.ok(Number.isFinite(samples.dx[0]) && Number.isFinite(samples.opacity[0]));
});
