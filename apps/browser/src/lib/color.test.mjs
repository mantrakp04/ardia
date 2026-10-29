import assert from "node:assert/strict";
import { test } from "node:test";
const { isLight, mix, over, parseColor, toHex } = await import("./color.ts");

test("light and dark backgrounds split where the toolbar's ink flips", () => {
  assert.equal(isLight("#F3EEE4"), true);
  assert.equal(isLight("#F6F8FC"), true);
  assert.equal(isLight("#1F1F1F"), false);
  assert.equal(isLight("#000000"), false);
});

test("a colour is light when black ink has more contrast on it than white, as Chrome picks badge text", () => {
  assert.equal(isLight("#FF9500"), true);
  assert.equal(isLight("#0A84FF"), true);
  assert.equal(isLight("#8E24AA"), false);
});

test("colours parse from hex with or without alpha and from rgb()/rgba()", () => {
  assert.deepEqual(parseColor("#336699"), [0x33, 0x66, 0x99, 1]);
  assert.deepEqual(parseColor("#33669980"), [0x33, 0x66, 0x99, 0x80 / 255]);
  assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor("rgb(10,20,30)"), [10, 20, 30, 1]);
});

test("hex output is clamped, rounded and upper case", () => {
  assert.equal(toHex([300, -4, 127.5]), "#FF0080");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(over("#FFFFFF80", "#000000"), "#808080");
  assert.equal(over("rgba(255,0,0,0.25)", "#0000ff"), "#4000BF");
});
