import assert from "node:assert/strict";
import { test } from "node:test";
const { menuSections, withOptionAlternate } = await import("./menuSections.ts");

test("sections drop empty groups and falsy slots, and separate the rest once", () => {
  const a = { id: "a", title: "A" };
  const b = { id: "b", title: "B" };
  assert.deepEqual(menuSections([a, false, null], [], [undefined], [b]), [a, { separator: true }, b]);
  assert.deepEqual(menuSections([], []), []);
});

test("an alternate pairs only with the shortcut it really has, and never invents one", () => {
  const p = { id: "copy", title: "Copy Link" };
  const m = { id: "md", title: "Copy Link as Markdown" };
  assert.deepEqual(withOptionAlternate(p, m), [p, { ...m, modifiers: ["option"], alternate: true }]);
  const paired = withOptionAlternate(p, m, { primary: { key: "c", modifiers: ["shift", "command"] }, alternate: { key: "c", modifiers: ["option", "shift", "command"] } });
  assert.equal(paired[1].alternate, true);
  assert.deepEqual(paired[1].modifiers, ["option", "shift", "command"]);
  const remapped = withOptionAlternate(p, m, { primary: { key: "c", modifiers: ["shift", "command"] }, alternate: { key: "m", modifiers: ["command"] } });
  assert.equal(remapped[1].alternate, undefined);
  assert.equal(remapped[1].key, "m");
  const unbound = withOptionAlternate(p, m, { primary: { key: "c", modifiers: ["shift", "command"] }, alternate: {} });
  assert.equal(unbound[1].alternate, undefined);
  assert.equal(unbound[1].key, undefined);
});
