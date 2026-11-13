import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { checkFixture, fixtureDifference, FIXTURE_FILE } = await import("../../../scripts/theme-backdrops.mjs");
const { backdropFixture, macTheme } = await import("./fixtures/themeBackdrops.ts");
const { sanitizeTheme } = await import("../../lib/profileLook.ts");

test("the comparison allows float noise and nothing more", () => {
  assert.equal(fixtureDifference({ a: [0.7868481141870542, "#FFFFFF", true] }, { a: [0.7868481141870544, "#FFFFFF", true] }), null);
  assert.equal(fixtureDifference({ a: [0.1, 1e-12] }, { a: [0.1, 0] }), null);
  assert.equal(fixtureDifference({ a: [0.1, 0.5] }, { a: [0.1, 0.5000001] }), ".a[1]: 0.5 is not 0.5000001");
  assert.equal(fixtureDifference({ a: "#FFFFFE" }, { a: "#FFFFFF" }), '.a: "#FFFFFE" is not "#FFFFFF"');
  assert.equal(fixtureDifference({ a: false }, { a: true }), ".a: false is not true");
  assert.equal(fixtureDifference({ a: [1, 2] }, { a: [1] }), ".a: 2 items, not 1");
  assert.equal(fixtureDifference({ a: 1, b: 2 }, { a: 1 }), ".b: not in the fixture");
});

test("the iPhone's backdrop fixture is what the Mac's own look functions give for each synced theme (node apps/browser/scripts/theme-backdrops.mjs --check)", () => {
  assert.ok(backdropFixture().cases.length >= 10);
  const found = checkFixture();
  if (found) assert.fail(found);
});

test("a fixture that drifts from the Mac's maths fails the check at the first differing value", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE_FILE, "utf8"));
  fixture.cases[3].expect.samples[2][1] += 1e-6;
  assert.match(checkFixture(JSON.stringify(fixture)), /^three stops with alpha and a dark look, dark app: \.expect\.samples\[2\]\[1\]: /);
});

test("every fixture theme is one the Mac would keep as it is", () => {
  for (const c of backdropFixture().cases) assert.deepEqual(sanitizeTheme(macTheme(c.theme)), macTheme(c.theme), c.name);
});
