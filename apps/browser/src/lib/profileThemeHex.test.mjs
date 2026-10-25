import assert from "node:assert/strict";
import { test } from "node:test";
import { colorHex, parseHex, startingTheme, withStopColor } from "./profileTheme.ts";

test("a typed hex code reads with or without # and in short form", () => {
  assert.equal(colorHex(parseHex("#7C5CFF")), "#7C5CFF");
  assert.equal(colorHex(parseHex("7c5cff")), "#7C5CFF");
  assert.equal(colorHex(parseHex(" #fa0 ")), "#FFAA00");
  assert.equal(parseHex("#12345"), null);
  assert.equal(parseHex("purple"), null);
});

test("setting a stop to an exact colour keeps that colour and moves its knob to the colour's hue", () => {
  const theme = startingTheme("#6E5BD6");
  const red = parseHex("#FF0000");
  const next = withStopColor(theme, 1, red);
  assert.equal(colorHex(next.stops[1].color), "#FF0000");
  assert.ok(next.stops[1].x > 0.9 && Math.abs(next.stops[1].y - 0.5) < 0.01, "red sits at the pad's right edge");
  assert.deepEqual(next.stops[0], theme.stops[0], "the other stops stay");
  assert.equal(withStopColor(theme, 5, red), theme);
});
