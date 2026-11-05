import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizePaste } from "./omnibox.ts";

test("a URL wrapped over lines joins with nothing between", () => {
  assert.equal(sanitizePaste("https://ex\nample.com/a"), "https://example.com/a");
  assert.equal(sanitizePaste("https://ex\r\n  ample.com"), "https://example.com");
});

test("prose with line breaks joins with a space", () => {
  assert.equal(sanitizePaste("a b\nc"), "a b c");
  assert.equal(sanitizePaste("one two\n\n three"), "one two three");
});

test("leading and trailing whitespace goes, inner spaces stay", () => {
  assert.equal(sanitizePaste("  https://x.com/\n  path  \n"), "https://x.com/path");
  assert.equal(sanitizePaste("one  two\n"), "one  two");
});

test("empty and all-whitespace pastes", () => {
  assert.equal(sanitizePaste(""), "");
  assert.equal(sanitizePaste("\n\n"), " ");
  assert.equal(sanitizePaste("plain"), "plain");
});

test("javascript: is stripped from pasted text, repeatedly and after control characters", () => {
  assert.equal(sanitizePaste("javascript:alert(1)"), "alert(1)");
  assert.equal(sanitizePaste("JavaScript: javascript:alert(1)"), "alert(1)");
  assert.equal(sanitizePaste("\u0001javascript://x%0Aalert(1)"), "//x%0Aalert(1)");
  assert.equal(sanitizePaste("java\nscript:alert(1)"), "alert(1)");
});
