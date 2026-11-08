import assert from "node:assert/strict";
import { test } from "node:test";
import { brandColorFor, pulseInk } from "./pulseInk.ts";
import { luminance, parseColor, rgbToHsl } from "../../lib/color.ts";
import { SCOPE_PULSE } from "./tokens.ts";

const hsl = (hex) => rgbToHsl(...parseColor(hex).slice(0, 3).map((v) => v / 255));
const inks = { neutral: "#FFFFFF", fallback: "#4A77D4" };

test("a site search finds its brand colour by host, subdomain or www", () => {
  assert.equal(brandColorFor("youtube.com"), "#FF0000");
  assert.equal(brandColorFor("www.youtube.com"), "#FF0000");
  assert.equal(brandColorFor("m.youtube.com"), "#FF0000");
  assert.equal(brandColorFor("maps.google.com"), "#34A853");
  assert.equal(brandColorFor("news.google.com"), "#4285F4");
  assert.equal(brandColorFor("example.org"), null);
  assert.equal(brandColorFor(""), null);
});

test("no colour falls back, a greyscale brand pulses neutral", () => {
  assert.equal(pulseInk(null, { dark: true, ...inks }), inks.fallback);
  assert.equal(pulseInk("not a colour", { dark: true, ...inks }), inks.fallback);
  assert.equal(pulseInk("#181717", { dark: true, ...inks }), inks.neutral);
  assert.equal(pulseInk("#FFFFFF", { dark: false, ...inks, neutral: "#000000" }), "#000000");
});

test("the pulse keeps the hue and stays inside the legible luminance band for each appearance", () => {
  for (const brand of ["#FF0000", "#F5C518", "#0A66C2", "#1DB954", "#6001D2", "#2932E1", "#FFB319", "#20808D", "#36ACB8"]) {
    for (const dark of [true, false]) {
      const out = pulseInk(brand, { dark, ...inks });
      const [h] = hsl(out);
      const [low, high] = dark ? SCOPE_PULSE.luminance.dark : SCOPE_PULSE.luminance.light;
      const l = luminance(out);
      assert.ok(l >= low - 0.01 && l <= high + 0.01, `${brand} ${dark ? "dark" : "light"} → ${out} luminance ${l}`);
      assert.ok(Math.abs(h - hsl(brand)[0]) < 0.02 || Math.abs(h - hsl(brand)[0]) > 0.98, `${brand} hue kept`);
    }
  }
});

test("a dark brand gets lighter on a dark bar and a pale brand darker on a light one", () => {
  assert.ok(luminance(pulseInk("#2932E1", { dark: true, ...inks })) > luminance("#2932E1"));
  assert.ok(luminance(pulseInk("#F5C518", { dark: false, ...inks })) < luminance("#F5C518"));
});
