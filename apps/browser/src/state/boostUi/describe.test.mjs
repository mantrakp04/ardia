import assert from "node:assert/strict";
import { test } from "node:test";
const { boostChanges, siteLine } = await import("./describe.ts");

const blank = { domain: "example.com", subdomains: false, colors: null, font: null, size: 100, textCase: "none", zaps: [], css: "", js: "" };

test("an untouched boost changes nothing", () => {
  assert.deepEqual(boostChanges(blank), []);
});

test("each setting adds one line", () => {
  const lines = boostChanges({ ...blank, colors: { invert: true }, font: "Futura", size: 125, textCase: "upper", zaps: ["a", "b"], css: "a{}\nb{}" });
  assert.deepEqual(lines, [
    "Recolours the page with inverted lightness",
    "Sets the font to Futura",
    "Sets the page zoom to 125%",
    "Shows text in UPPERCASE",
    "Hides 2 elements",
    "Adds 2 lines of CSS",
  ]);
});

test("the site line follows include subdomains", () => {
  assert.equal(siteLine(blank), "example.com and www.example.com");
  assert.equal(siteLine({ ...blank, subdomains: true }), "example.com and every subdomain");
});
