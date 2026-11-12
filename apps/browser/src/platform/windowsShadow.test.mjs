import assert from "node:assert/strict";
import { test } from "node:test";
import { MOST_SHADOW_RINGS, shadowIntensityOutside, shadowLayers, shadowReach, shadowSpec } from "../../../../packages/expo-windows/src/views/shadowLayers.ts";

const alphaOf = (color) => Number(/rgba\([^)]*,([\d.]+)\)/.exec(color)?.[1]);
const outsetOf = (layer, spec) => -(layer.left - spec.x);

test("no colour or no opacity means no shadow", () => {
  assert.equal(shadowSpec(undefined, 0.2, 4, 0, 1), null);
  assert.equal(shadowSpec("#000000", 0, 4, 0, 1), null);
  assert.equal(shadowSpec("#000000", Number.NaN, 4, 0, 1), null);
});

test("a blurred shadow is rounded rings outside the edge that never overlap and never cover the surface", () => {
  for (const [opacity, radius] of [[0.08, 2], [0.04, 1], [0.18, 24], [0.5, 24]]) {
    const spec = shadowSpec("#000000", opacity, radius, 0, 0);
    const rings = shadowLayers(spec, 20);
    assert.ok(rings.length >= 1 && rings.length <= MOST_SHADOW_RINGS);
    let inner = 0;
    for (const ring of rings) {
      assert.equal(ring.backgroundColor, undefined, "a ring leaves its middle clear");
      const outer = outsetOf(ring, spec);
      assert.ok(Math.abs(outer - ring.borderWidth - inner) < 1e-9, "each ring starts where the last one ended");
      assert.equal(ring.borderRadius, 20 + outer, "the ring follows the rounded corner");
      inner = outer;
    }
    assert.ok(Math.abs(inner - shadowReach(spec.blur)) < 1e-9, "the rings reach out 2.5 deviations");
  }
});

test("the rings fade outwards like a Gaussian blur of the edge", () => {
  const spec = shadowSpec("#000000", 0.18, 24, 0, 10);
  const alphas = shadowLayers(spec, 20).map((ring) => alphaOf(ring.borderColor));
  for (let index = 1; index < alphas.length; index++) assert.ok(alphas[index] < alphas[index - 1], "each ring is fainter than the one inside it");
  assert.ok(alphas[0] < 0.18 * 0.5 && alphas[0] > 0.18 * 0.35, `the first ring is just under half the opacity: ${alphas[0]}`);
  assert.ok(Math.abs(shadowIntensityOutside(0, 3) - 0.5) < 1e-6);
});

test("the rings follow the offset", () => {
  const spec = shadowSpec("#000000", 0.18, 24, 3, 10);
  for (const ring of shadowLayers(spec, 20)) {
    assert.ok(Math.abs(ring.top - ring.bottom - 2 * spec.y) < 1e-9);
    assert.ok(Math.abs(ring.left - ring.right - 2 * spec.x) < 1e-9);
  }
});

test("a shadow with no blur is one filled layer the shape of the surface", () => {
  const layers = shadowLayers(shadowSpec("#000000", 0.3, 0, 0, 0), 12, { top: -1, left: -1, right: -1, bottom: -1 });
  assert.equal(layers.length, 1);
  assert.deepEqual([layers[0].top, layers[0].left, layers[0].right, layers[0].bottom, layers[0].borderRadius], [-1, -1, -1, -1, 12]);
  assert.equal(alphaOf(layers[0].backgroundColor), 0.3);
});
