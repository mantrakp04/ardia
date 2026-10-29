import assert from "node:assert/strict";
import { test } from "node:test";
const { zoomChangedByUser, toggleZoomPopover, dismissZoomPopover, hoverZoomPopover, isZoomBubble } = await import("./zoomBubble.ts");
const { popoverOf, setPopover } = await import("../tabs/pageState.ts");

test("a user zoom change opens the zoom popover as a bubble that closes 1.5 s after the last change", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  zoomChangedByUser("a");
  assert.equal(popoverOf("a"), "zoom");
  assert.equal(isZoomBubble("a"), true);
  t.mock.timers.tick(1000);
  zoomChangedByUser("a");
  t.mock.timers.tick(1000);
  assert.equal(popoverOf("a"), "zoom", "each step restarts the timer");
  t.mock.timers.tick(500);
  assert.equal(popoverOf("a"), null);
  assert.equal(isZoomBubble("a"), false);
});

test("the pointer over the bubble holds it open until it leaves", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  zoomChangedByUser("b");
  hoverZoomPopover("b", true);
  t.mock.timers.tick(5000);
  assert.equal(popoverOf("b"), "zoom");
  hoverZoomPopover("b", false);
  t.mock.timers.tick(1499);
  assert.equal(popoverOf("b"), "zoom");
  t.mock.timers.tick(1);
  assert.equal(popoverOf("b"), null);
});

test("a popover opened from the magnifier stays until dismissed, also through zoom changes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  toggleZoomPopover("c");
  zoomChangedByUser("c");
  t.mock.timers.tick(5000);
  assert.equal(popoverOf("c"), "zoom");
  assert.equal(isZoomBubble("c"), false);
  dismissZoomPopover("c");
  assert.equal(popoverOf("c"), null);
});

test("clicking the magnifier while the bubble shows keeps the popover open for good", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  zoomChangedByUser("d");
  toggleZoomPopover("d");
  t.mock.timers.tick(5000);
  assert.equal(popoverOf("d"), "zoom");
  toggleZoomPopover("d");
  assert.equal(popoverOf("d"), null);
});

test("a zoom change leaves another open popover alone", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setPopover("e", "siteControls");
  zoomChangedByUser("e");
  assert.equal(popoverOf("e"), "siteControls");
  assert.equal(isZoomBubble("e"), false);
});

test("a bubble replaced by another popover never closes that one", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  zoomChangedByUser("f");
  setPopover("f", "popups");
  t.mock.timers.tick(2000);
  assert.equal(popoverOf("f"), "popups");
  assert.equal(isZoomBubble("f"), false);
});
