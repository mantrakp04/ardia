import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../ios/ArdiaWindowController.mm", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`void ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
}

test("a tab nobody opened is hosted only by a view the user can see, otherwise it is announced as a stray tab", () => {
  const handOff = functionBody("HandOffTab");
  const hosted = handOff.slice(handOff.indexOf("hostingViewForProfile:profile"), handOff.indexOf("AnnounceStrayTab"));
  assert.match(hosted, /view && view\.visible && \(/, "HandOffTab re-homes a script-created tab onto a hidden pre-loaded New Tab view");
});
