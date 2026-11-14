import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SIDEBAR_EDGE, overSidebar, sidebarEdgeOf } from "./sidebarEdge.ts";

test("left sidebar: a drop left of its right edge lands in it", () => {
  const edge = sidebarEdgeOf({ shown: true, side: "left", sidebarWidth: 190, windowWidth: 1200 });
  assert.deepEqual(edge, { side: "left", x: 190 });
  assert.equal(overSidebar(edge, 120), true);
  assert.equal(overSidebar(edge, 190), false);
  assert.equal(overSidebar(edge, 600), false);
});

test("right sidebar: the rule flips to the sidebar's left edge", () => {
  const edge = sidebarEdgeOf({ shown: true, side: "right", sidebarWidth: 190, windowWidth: 1200 });
  assert.deepEqual(edge, { side: "right", x: 1010 });
  assert.equal(overSidebar(edge, 1100), true);
  assert.equal(overSidebar(edge, 1010), false);
  assert.equal(overSidebar(edge, 120), false);
});

test("a hidden sidebar takes no drops on either side", () => {
  const left = sidebarEdgeOf({ shown: false, side: "left", sidebarWidth: 190, windowWidth: 1200 });
  assert.deepEqual(left, NO_SIDEBAR_EDGE);
  assert.equal(overSidebar(left, 50), false);
  const right = sidebarEdgeOf({ shown: false, side: "right", sidebarWidth: 190, windowWidth: 1200 });
  assert.equal(overSidebar(right, 1190), false);
});

test("right sidebar before the window frame is known: no drops", () => {
  assert.equal(overSidebar(sidebarEdgeOf({ shown: true, side: "right", sidebarWidth: 190, windowWidth: undefined }), 1190), false);
});
