import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const eyeInset = ");
const end = script.indexOf("  const placeEye = ", start);
assert.ok(start > 0 && end > start, "page_script.js has eyeInset and eyeLeft");
const eyeLeft = new Function(`${script.slice(start, end)}\nreturn eyeLeft;`)();

const field = { left: 100, right: 400 };
const style = (direction, extra = {}) => ({
  direction,
  borderLeftWidth: "1px",
  borderRightWidth: "1px",
  paddingLeft: "8px",
  paddingRight: "8px",
  ...extra,
});

test("a left-to-right field puts the eye at its right edge, inside the border and padding", () => {
  assert.equal(eyeLeft(field, style("ltr"), 20), 400 - 1 - 8 - 20);
});

test("a right-to-left field puts the eye at its left edge, where the text ends, not on top of where it starts", () => {
  assert.equal(eyeLeft(field, style("rtl"), 20), 100 + 1 + 8);
});

test("each side reads its own border and padding, so asymmetric fields stay inside the box", () => {
  const lopsided = { borderLeftWidth: "3px", borderRightWidth: "0px", paddingLeft: "6px", paddingRight: "40px" };
  assert.equal(eyeLeft(field, style("rtl", lopsided), 20), 100 + 3 + 6);
  assert.equal(eyeLeft(field, style("ltr", lopsided), 20), 400 - 0 - 10 - 20);
});

test("padding is clamped the same way on both sides", () => {
  const bare = { borderLeftWidth: "", borderRightWidth: "", paddingLeft: "0px", paddingRight: "0px" };
  assert.equal(eyeLeft(field, style("rtl", bare), 18), 100 + 4);
  assert.equal(eyeLeft(field, style("ltr", bare), 18), 400 - 4 - 18);
});

test("a field with no resolved direction falls back to the right edge", () => {
  assert.equal(eyeLeft(field, style(""), 20), 400 - 1 - 8 - 20);
});
