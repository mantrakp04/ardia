import assert from "node:assert/strict";
import { test } from "node:test";
const { colorMatrix, compileBoost, boostStylesheet, fitsEngine, fitEngineList } = await import("./compile.ts");
const { DEFAULT_COLORS } = await import("./types.ts");

const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `[${i}] ${value} != ${expected[i]}`));
};

const blank = { id: "b", name: "n", author: "", domain: "example.com", subdomains: false, enabled: true, colors: null, font: null, size: 100, textCase: "none", zaps: [], css: "", js: "", modified: 0 };

test("the default colours give Arc's matrix", () => {
  near(colorMatrix(DEFAULT_COLORS), [0, 0, 210 / 360 - 240 / 360, 0, 240 / 360, 0, 0.5, 0, 0, 0.3, 0, 0, 0.82, 0, 0.12, 0, 0, 0, 1, 0]);
});

test("invert flips the lightness row", () => {
  near(colorMatrix({ ...DEFAULT_COLORS, invert: true }).slice(10, 15), [0, 0, -0.82, 0, 0.94]);
});

test("brightness shifts the lightness offset by a fifth", () => {
  near(colorMatrix({ ...DEFAULT_COLORS, brightness: 1 }).slice(10, 15), [0, 0, 0.82, 0, 0.32]);
  near(colorMatrix({ ...DEFAULT_COLORS, brightness: -0.5, invert: true }).slice(10, 15), [0, 0, -0.82, 0, 0.84]);
});

test("full contrast keeps lightness, zero saturation keeps the page's saturation", () => {
  near(colorMatrix({ ...DEFAULT_COLORS, contrast: 1, saturation: 0, originalSaturation: 1 }).slice(5, 15), [0, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
});

test("the secondary hue is not wrapped", () => {
  const m = colorMatrix({ ...DEFAULT_COLORS, hue: 350, offset: 30 });
  near([m[2], m[4]], [350 / 360 - 380 / 360, 380 / 360]);
});

test("the stylesheet hides zaps, sets font and case, then user css", () => {
  const css = boostStylesheet({ zaps: [".ad", "#banner"], font: 'Say "hi"', textCase: "title", css: "body{color:red}" });
  assert.equal(
    css,
    [
      ".ad{display:none !important;}",
      "#banner{display:none !important;}",
      '*:not(i, .material-symbols-outlined, .material-icons){font-family:"Say \\"hi\\"" !important;}',
      "*:not(i, .material-symbols-outlined, .material-icons){text-transform:capitalize !important;}",
      "body{color:red}",
    ].join("\n"),
  );
  assert.equal(boostStylesheet(blank), "");
});

test("a compiled boost carries zoom, scheme and matrix", () => {
  const plain = compileBoost(blank);
  assert.deepEqual(plain, { id: "b", domain: "example.com", subdomains: false, css: "", js: "", zoom: 100, color: null, scheme: null });
  const dark = compileBoost({ ...blank, size: 125, textCase: "upper", colors: { ...DEFAULT_COLORS, appearance: "dark" } });
  assert.equal(dark.zoom, 125);
  assert.equal(dark.scheme, 1);
  assert.equal(dark.color.length, 20);
  assert.ok(dark.css.includes("uppercase"));
  assert.equal(compileBoost({ ...blank, colors: { ...DEFAULT_COLORS, appearance: "light" } }).scheme, 0);
});

test("a zap that would break out of its rule is left out", () => {
  assert.equal(boostStylesheet({ ...blank, zaps: [".ad", ".x{}body{display:none}", " "] }), ".ad{display:none !important;}");
});

test("a picker-escaped selector keeps its rule, a trailing backslash does not", () => {
  assert.equal(boostStylesheet({ ...blank, zaps: [".post\\:card", ".x\\"] }), ".post\\:card{display:none !important;}");
});

test("compiled code is measured in UTF-8 bytes against the engine limit", () => {
  assert.ok(fitsEngine(compileBoost({ ...blank, css: "a".repeat(1024 * 1024) })));
  assert.ok(!fitsEngine(compileBoost({ ...blank, css: "a".repeat(1024 * 1024), font: "Inter" })));
  assert.ok(!fitsEngine(compileBoost({ ...blank, js: "é".repeat(600 * 1024) })));
});

test("the engine list stops at 1000 boosts and 32 MiB", () => {
  const many = Array.from({ length: 1200 }, (_, i) => compileBoost({ ...blank, id: String(i) }));
  assert.equal(fitEngineList(many).length, 1000);
  const big = Array.from({ length: 40 }, (_, i) => compileBoost({ ...blank, id: String(i), css: "a".repeat(1024 * 1024) }));
  assert.equal(fitEngineList(big).length, 31);
});

test("a boost too big for the engine list doesn't hide the small ones after it", () => {
  const big = Array.from({ length: 40 }, (_, i) => compileBoost({ ...blank, id: String(i).padStart(2, "0"), css: "a".repeat(1024 * 1024) }));
  const small = compileBoost({ ...blank, id: "zz" });
  assert.ok(fitEngineList([...big, small]).some((b) => b.id === "zz"));
});
