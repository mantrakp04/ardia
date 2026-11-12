import assert from "node:assert/strict";
import { test } from "node:test";
import { switcherScrollOffset } from "./profileSwitcherLayout.ts";

test("fitting identities never scroll", () => {
  assert.equal(switcherScrollOffset([34, 34], 1, 172), 0);
});

test("overflow keeps the selected profile within the viewport", () => {
  const widths = Array(9).fill(34);
  for (let selected = 0; selected < widths.length; selected++) {
    const offset = switcherScrollOffset(widths, selected, 172);
    assert.ok(offset >= 0 && offset <= 306 - 172);
    assert.ok(selected * 34 >= offset);
    assert.ok((selected + 1) * 34 <= offset + 172);
  }
});

test("missing profiles and empty lists return the beginning", () => {
  assert.equal(switcherScrollOffset([], -1, 172), 0);
  assert.equal(switcherScrollOffset([34], 3, 172), 0);
});
