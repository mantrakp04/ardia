import assert from "node:assert/strict";
import { test } from "node:test";

const { hoverLayout, measureForHover, moveHoverLayout, registerRow } = await import("./state.ts");

test("a hover measurement lands only if the layout hasn't moved and its row is still the one measured", async () => {
  const pending = [];
  const row = () => ({ measureInWindow: (done) => pending.push(done) });
  registerRow("hw1", "a", row());
  const current = measureForHover("hw1", "a");
  pending.shift()(10, 40, 170, 30);
  assert.deepEqual(await current, { anchor: { x: 10, y: 40, width: 170, height: 30 }, layout: hoverLayout("hw1") });
  const moved = measureForHover("hw1", "a");
  moveHoverLayout("hw1");
  pending.shift()(10, 40, 170, 30);
  assert.equal(await moved, null, "measured before the side switched");
  const replaced = measureForHover("hw1", "a");
  registerRow("hw1", "a", row());
  pending.shift()(10, 40, 170, 30);
  assert.equal(await replaced, null, "its row was replaced while measured");
  const removed = measureForHover("hw1", "a");
  registerRow("hw1", "a", null);
  pending.shift()(10, 40, 170, 30);
  assert.equal(await removed, null, "its row went while measured");
});
