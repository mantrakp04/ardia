import assert from "node:assert/strict";
import { test } from "node:test";
import { linearGradientCss } from "./gradient.ts";

test("a backdrop runs top to bottom through evenly spaced stops", () => {
  assert.equal(linearGradientCss(["#111111", "#222222"], false, 400, 800), "linear-gradient(180deg, #111111 0%, #222222 100%)");
  assert.equal(linearGradientCss(["#1", "#2", "#3"], false, 1, 1), "linear-gradient(180deg, #1 0%, #2 50%, #3 100%)");
  assert.equal(linearGradientCss(["#ABCDEF"], false, 1, 1), "linear-gradient(180deg, #ABCDEF 0%, #ABCDEF 100%)");
});

test("the Mac theme's diagonal runs from the top-left corner to the bottom-right one, as Compose draws it", () => {
  assert.equal(linearGradientCss(["#000000", "#FFFFFF"], true, 100, 100), "linear-gradient(135deg, #000000 0%, #FFFFFF 100%)");
  assert.equal(linearGradientCss(["#000000", "#FFFFFF"], true, 400, 800), "linear-gradient(153.43deg, #000000 0%, #FFFFFF 100%)");
  assert.equal(linearGradientCss(["#000000", "#FFFFFF"], true, 0, 800), "linear-gradient(180deg, #000000 0%, #FFFFFF 100%)");
});
