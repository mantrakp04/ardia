import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");

const S = () => useBrowser.getState();

function profiles() {
  S().hydrate({});
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B" });
  const c = S().createProfile({ name: "C" });
  return { a, b, c };
}

test("moveProfile moves one slot and stops at the ends", () => {
  const { a, b, c } = profiles();
  assert.deepEqual(S().profileOrder, ["default", a, b, c]);
  S().moveProfile(c, -1);
  assert.deepEqual(S().profileOrder, ["default", a, c, b]);
  S().moveProfile(a, 1);
  assert.deepEqual(S().profileOrder, ["default", c, a, b]);
  S().moveProfile("default", -1);
  assert.deepEqual(S().profileOrder, ["default", c, a, b]);
  S().moveProfile(b, 1);
  assert.deepEqual(S().profileOrder, ["default", c, a, b]);
});

test("reorderProfiles keeps every profile once", () => {
  const { a, b, c } = profiles();
  S().reorderProfiles([c, a]);
  assert.deepEqual(S().profileOrder, [c, a, "default", b]);
  S().reorderProfiles([b, "default", c, a]);
  assert.deepEqual(S().profileOrder, [b, "default", c, a]);
});
