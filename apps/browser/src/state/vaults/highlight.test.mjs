import assert from "node:assert/strict";
import { test } from "node:test";
import { luminance } from "../../lib/color.ts";
import { vaultHighlight } from "./highlight.ts";

const DARK_GLASS = "#3F3F3F";
const LIGHT_GLASS = "#DBDBDB";
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const ink = (h) => (h.onLight ? "#000000" : "#FFFFFF");

test("the selected row takes the site's colour when the frame does, else the frame's colour, else the fallback", () => {
  assert.equal(vaultHighlight("#1A73E8", true, "#9B59B6", "#0A84FF", "#1E1E1E").fill, "#1A73E8");
  assert.equal(vaultHighlight("#1A73E8", false, "#9B59B6", "#0A84FF", "#1E1E1E").fill, "#9B59B6");
  assert.equal(vaultHighlight(null, true, "#9B59B6", "#0A84FF", "#1E1E1E").fill, "#9B59B6");
  assert.equal(vaultHighlight("rgb(1,2,3)", true, null, "#0A84FF", "#1E1E1E").fill, "#0A84FF");
});

test("any site colour stays readable and stands apart from the glass in both appearances", () => {
  const colors = ["#FFFFFF", "#000000", "#717171", "#E6E6E6", "#FFD60A", "#FF3B30", "#34C759", "#1C1C1E", "#5856D6", "#8E8E93", "#00FFFF", "#7A1F1F"];
  for (const surface of [DARK_GLASS, LIGHT_GLASS])
    for (const color of colors) {
      const h = vaultHighlight(color, true, null, "#0A84FF", surface);
      assert.ok(ratio(ink(h), h.fill) >= 4.5, `${color} on ${surface}: text ${ratio(ink(h), h.fill).toFixed(2)}`);
      assert.ok(ratio(h.fill, surface) >= 1.6, `${color} on ${surface}: apart ${ratio(h.fill, surface).toFixed(2)}`);
    }
});
