import assert from "node:assert/strict";
import { test } from "node:test";
import { noteTabStripGroupToggle, takeTabStripCounts } from "./tabStripCounts.ts";

test("group collapses and expands from the strip are counted, and taking them starts over", () => {
  noteTabStripGroupToggle();
  noteTabStripGroupToggle();
  assert.deepEqual(takeTabStripCounts(), { tab_strip_group_toggles: 2 });
  assert.deepEqual(takeTabStripCounts(), { tab_strip_group_toggles: 0 });
});
