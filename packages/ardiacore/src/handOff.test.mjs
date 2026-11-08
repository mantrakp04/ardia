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

function hostCondition() {
  const handOff = functionBody("HandOffTab");
  const from = handOff.indexOf("hostingViewForProfile:profile");
  const to = handOff.indexOf("AnnounceStrayTab");
  assert.ok(from !== -1 && to > from, "HandOffTab picks a host view, then falls through to AnnounceStrayTab");
  return handOff.slice(from, to);
}

test("a tab nobody opened is not re-homed onto a hidden pre-loaded view while a stray-tab listener can adopt it", () => {
  assert.match(hostCondition(), /view && \(view\.visible \|\| /, "HandOffTab re-homes a script-created tab onto a hidden pre-loaded New Tab view");
});

test("a tab nobody opened still goes to a hidden view when no stray-tab listener exists to adopt it", () => {
  assert.match(hostCondition(), /view && \(view\.visible \|\| !\[ArdiaEvents listens:@"extensions"\]\) &&/, "the tab would be dropped without a host");
  assert.match(functionBody("AnnounceStrayTab"), /if \(!\[ArdiaEvents listens:@"extensions"\]\) return;/);
});
