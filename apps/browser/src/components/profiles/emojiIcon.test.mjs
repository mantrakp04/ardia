import assert from "node:assert/strict";
import { test } from "node:test";
const { isEmojiIcon } = await import("./emojiIcon.ts");

test("accepts one emoji grapheme of every kind", () => {
  for (const emoji of ["😀", "✈️", "⭐️", "🧑‍💻", "👍🏽", "🇪🇨", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "#️⃣", "👨‍👩‍👧‍👦", "🔥"]) {
    assert.equal(isEmojiIcon(emoji), true, emoji);
  }
});

test("rejects text, symbols and partial sequences", () => {
  for (const value of ["", "a", "hello", "中", "é", "→", "™", "↔", "▪", "‼", "1", "🇺", "😀😀", "a😀", "😀 ", "️", "‍", "🏽", "symbol:house.fill", null]) {
    assert.equal(isEmojiIcon(value), false, String(value));
  }
});
