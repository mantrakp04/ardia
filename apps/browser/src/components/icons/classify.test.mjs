import assert from "node:assert/strict";
import { test } from "node:test";
const { classifyIcon, isSingleEmoji, isSingleGlyph } = await import("./classify.ts");
const { GLYPHS } = await import("./glyphs.ts");

test("accepts one emoji grapheme of every kind", () => {
  for (const emoji of ["😀", "✈️", "⭐️", "🧑‍💻", "👍🏽", "🇪🇨", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "#️⃣", "👨‍👩‍👧‍👦", "🔥"]) {
    assert.equal(isSingleEmoji(emoji), true, emoji);
    assert.equal(classifyIcon(emoji).kind, "emoji", emoji);
  }
});

test("rejects text, symbols and partial sequences as emoji", () => {
  for (const value of ["", "a", "hello", "中", "é", "→", "™", "↔", "▪", "‼", "1", "🇺", "😀😀", "a😀", "😀 ", "️", "‍", "🏽", "symbol:house.fill", null]) {
    assert.equal(isSingleEmoji(value), false, String(value));
  }
});

test("accepts one glyph, including combining marks", () => {
  for (const glyph of ["◆", "→", "§", "⌘", "♥", "中", "A", "é", "e\u0301"]) {
    assert.equal(isSingleGlyph(glyph), true, glyph);
    assert.equal(classifyIcon(glyph).kind, "glyph", glyph);
  }
});

test("rejects joined, spaced and multi-character text as a glyph", () => {
  for (const value of ["", " ", "\t", "hello", "◆◆", "a😀", "😀", "\u200D", "\uFE0F", "🏽", "🇺"]) {
    assert.equal(isSingleGlyph(value), false, String(value));
  }
});

test("classifies symbols, initials and legacy text", () => {
  assert.deepEqual(classifyIcon(null), { kind: "initial" });
  assert.deepEqual(classifyIcon(""), { kind: "initial" });
  assert.deepEqual(classifyIcon("symbol:"), { kind: "initial" });
  assert.deepEqual(classifyIcon("symbol:house.fill"), { kind: "symbol", name: "house.fill" });
  assert.deepEqual(classifyIcon("hello"), { kind: "text", text: "hello" });
  assert.deepEqual(classifyIcon("◆◆"), { kind: "text", text: "◆◆" });
});

test("every curated glyph is a glyph with search words, once", () => {
  const seen = new Set();
  for (const glyph of GLYPHS) {
    assert.equal(classifyIcon(glyph.char).kind, "glyph", glyph.char);
    assert.ok(glyph.words.trim().length > 0, glyph.char);
    assert.equal(seen.has(glyph.char), false, glyph.char);
    seen.add(glyph.char);
  }
});
