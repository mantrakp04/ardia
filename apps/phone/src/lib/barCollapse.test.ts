import assert from "node:assert/strict";
import { test } from "node:test";
import { BAR_SHOWN, barShown, followScroll, pageInsets } from "./barCollapse.ts";

test("the bar hides when the page scrolls down and comes back when it scrolls up", () => {
  const opened = followScroll(BAR_SHOWN, "a", "up", true);
  assert.equal(opened.hidden, false);
  const down = followScroll(opened, "a", "down", true);
  assert.equal(down.hidden, true);
  assert.equal(followScroll(down, "a", "down", true), down);
  assert.equal(followScroll(down, "a", "up", true).hidden, false);
});

test("the bar stays put with the setting off", () => {
  const opened = followScroll(BAR_SHOWN, "a", "up", false);
  assert.equal(followScroll(opened, "a", "down", false).hidden, false);
});

test("turning the setting off brings a hidden bar back", () => {
  const down = followScroll(followScroll(BAR_SHOWN, "a", "up", true), "a", "down", true);
  assert.equal(followScroll(down, "a", "down", false).hidden, false);
});

test("another tab starts with the bar shown, even one left scrolled down", () => {
  const down = followScroll(followScroll(BAR_SHOWN, "a", "up", true), "a", "down", true);
  const other = followScroll(down, "b", "down", true);
  assert.equal(other.hidden, false);
  assert.equal(followScroll(other, "b", "down", true).hidden, false);
  assert.equal(followScroll(followScroll(other, "b", "up", true), "b", "down", true).hidden, true);
});

test("showing the bar keeps the direction, so it hides again only on the next scroll down", () => {
  const down = followScroll(followScroll(BAR_SHOWN, "a", "up", true), "a", "down", true);
  const shown = barShown(down);
  assert.equal(shown.hidden, false);
  assert.equal(followScroll(shown, "a", "down", true).hidden, false);
});

test("a collapsing bar lays the page under the bar and samples its tone under the whole bar", () => {
  assert.deepEqual(pageInsets(false, 90, 12), { pageBottom: 78, toneBottom: 12 });
  assert.deepEqual(pageInsets(true, 90, 12), { pageBottom: 0, toneBottom: 90 });
});
