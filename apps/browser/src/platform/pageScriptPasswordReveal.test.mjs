import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const placeEye = ");
const end = script.indexOf("  const hideEye = ", start);
assert.ok(start > 0 && end > start, "page_script.js has placeEye");
const source = script.slice(start, end);

const box = { left: 100, right: 400, top: 50, height: 36 };
const eyeSize = 24;

function eyeIn(style) {
  const eyeHost = { style: {} };
  const eyeButton = { style: {} };
  const eyeField = { getBoundingClientRect: () => box };
  const getComputedStyle = () => ({
    direction: "ltr",
    borderLeftWidth: "1px",
    borderRightWidth: "1px",
    paddingLeft: "8px",
    paddingRight: "8px",
    color: "rgb(0, 0, 0)",
    ...style,
  });
  new Function("eyeHost", "eyeButton", "eyeField", "getComputedStyle", `${source}placeEye();`)(eyeHost, eyeButton, eyeField, getComputedStyle);
  const left = parseFloat(eyeHost.style.left);
  return { left, right: left + eyeSize, top: parseFloat(eyeHost.style.top) };
}

test("a left-to-right field keeps the eye inside its right edge", () => {
  assert.equal(eyeIn({ direction: "ltr" }).right, box.right - 1 - 8);
});

test("a right-to-left field gets the eye inside its left edge, away from where the text starts", () => {
  assert.equal(eyeIn({ direction: "rtl" }).left, box.left + 1 + 8);
});

test("the eye reads the border and padding of the side it sits on", () => {
  const uneven = { borderLeftWidth: "3px", paddingLeft: "6px", borderRightWidth: "0px", paddingRight: "9px" };
  assert.equal(eyeIn({ direction: "rtl", ...uneven }).left, box.left + 3 + 6);
  assert.equal(eyeIn({ direction: "ltr", ...uneven }).right, box.right - 0 - 9);
});

test("direction moves the eye sideways only", () => {
  assert.equal(eyeIn({ direction: "rtl" }).top, eyeIn({ direction: "ltr" }).top);
});
