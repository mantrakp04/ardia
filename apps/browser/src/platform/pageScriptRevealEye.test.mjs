import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const placeEye = () => {");
const end = script.indexOf("  const hideEye = () => {");
assert.ok(start > 0 && end > start, "page_script.js has placeEye");
const placeEyeBlock = script.slice(start, end);

const FIELD = { left: 100, right: 400, top: 50, height: 40 };

function place({ rect = FIELD, style = {} } = {}) {
  const eyeHost = { style: {} };
  const eyeButton = { style: {} };
  const eyeField = {
    getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left }),
  };
  const computed = {
    direction: "ltr",
    color: "rgb(1, 2, 3)",
    paddingLeft: "0px",
    paddingRight: "0px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    ...style,
  };
  new Function("eyeHost", "eyeField", "eyeButton", "getComputedStyle", `${placeEyeBlock}placeEye();`)(
    eyeHost,
    eyeField,
    eyeButton,
    (el) => (el === eyeField ? computed : assert.fail("the eye reads the password field's own style")),
  );
  return { left: parseFloat(eyeHost.style.left), top: parseFloat(eyeHost.style.top), size: parseFloat(eyeButton.style.width), eyeHost, eyeButton };
}

test("in a left-to-right field the eye sits at the right inner edge", () => {
  const eye = place();
  assert.equal(eye.size, 24);
  assert.equal(eye.left, 400 - 4 - 24);
  assert.equal(eye.top, 50 + (40 - 24) / 2);
  assert.equal(eye.eyeButton.style.color, "rgb(1, 2, 3)");
});

test("in a left-to-right field the eye keeps the right padding and border", () => {
  assert.equal(place({ style: { paddingRight: "8px", borderRightWidth: "2px" } }).left, 400 - 2 - 8 - 24);
  assert.equal(place({ style: { paddingRight: "30px", borderRightWidth: "1px" } }).left, 400 - 1 - 10 - 24);
});

test("in a right-to-left field the eye sits at the left inner edge, away from where the text starts", () => {
  const eye = place({ style: { direction: "rtl" } });
  assert.equal(eye.left, 100 + 4);
  assert.equal(eye.top, 50 + (40 - 24) / 2);
  assert.equal(eye.eyeButton.style.color, "rgb(1, 2, 3)");
});

test("in a right-to-left field the eye keeps the left padding and border, not the right ones", () => {
  assert.equal(place({ style: { direction: "rtl", paddingLeft: "8px", borderLeftWidth: "2px", paddingRight: "9px", borderRightWidth: "3px" } }).left, 100 + 2 + 8);
  assert.equal(place({ style: { direction: "rtl", paddingLeft: "30px", borderLeftWidth: "1px" } }).left, 100 + 1 + 10);
});

test("a field's own direction decides, so a left-to-right password field on a right-to-left page keeps the eye on the right", () => {
  const eye = place({ style: { direction: "ltr", paddingLeft: "6px", paddingRight: "6px" } });
  assert.equal(eye.left, 400 - 6 - 24);
});

test("the eye follows the field's rectangle in both directions", () => {
  const rect = { left: 20, right: 220, top: 300, height: 30 };
  assert.equal(place({ rect }).left, 220 - 4 - 22);
  assert.equal(place({ rect, style: { direction: "rtl" } }).left, 20 + 4);
  assert.equal(place({ rect, style: { direction: "rtl" } }).top, 300 + (30 - 22) / 2);
});
