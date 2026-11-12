import assert from "node:assert/strict";
import { test } from "node:test";
const { toolbarBounces } = await import("./toolbarBounces.ts");

function tracker(tabs) {
  let at = 1000;
  const t = toolbarBounces((id) => tabs.has(id), () => at);
  return { t, advance: (ms) => (at += ms) };
}

test("a hide within a second of that tab's bar showing is a bounce; a later one isn't", () => {
  const { t, advance } = tracker(new Set(["a"]));
  assert.deepEqual(t.note({ a: true }, {}), { hides: 1, bounces: 0 });
  t.note({}, { a: true });
  advance(300);
  assert.deepEqual(t.note({ a: true }, {}), { hides: 1, bounces: 1 });
  t.note({}, { a: true });
  advance(1500);
  assert.deepEqual(t.note({ a: true }, {}), { hides: 1, bounces: 0 });
});

test("closed tabs and old shows aren't kept", () => {
  const tabs = new Set();
  const { t, advance } = tracker(tabs);
  for (let i = 0; i < 100; i++) {
    t.note({ [`t${i}`]: true }, {});
    t.note({}, { [`t${i}`]: true });
  }
  assert.equal(t.tracked, 0);
  tabs.add("open");
  t.note({ open: true }, {});
  t.note({}, { open: true });
  assert.equal(t.tracked, 1);
  advance(1000);
  t.note({ other: true }, {});
  assert.equal(t.tracked, 0);
});
