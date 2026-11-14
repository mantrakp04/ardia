import assert from "node:assert/strict";
import { test } from "node:test";
import { PAGE_FRAME } from "../../lib/windowLayout.ts";
import { ARC_LIGHTS_CENTER, LIGHTS_CENTER, toolbarLightsCenter } from "../../state/windows/dockMotion.ts";
import { layout } from "../ui/theme.ts";
const geometry = await import("./geometry.ts");

const lightsToFirstRow = (compact, frame) => {
  const lightsY = toolbarLightsCenter(compact, frame)[1];
  return geometry.firstRowTopOf(false, lightsY) - lightsY;
};

test("with the lights at their default place the header and the first row keep the layout's numbers", () => {
  const lightsY = LIGHTS_CENTER[1];
  assert.equal(geometry.sidebarHeaderOf(false, lightsY), layout.sidebarHeader);
  assert.equal(geometry.firstRowTopOf(false, lightsY), layout.pinnedTop);
});

test("compact, borderless and both lift the header and the first row with the lights", () => {
  const lift = (compact, frame) => layout.sidebarHeader - geometry.sidebarHeaderOf(false, toolbarLightsCenter(compact, frame)[1]);
  assert.equal(lift(false, PAGE_FRAME.default), 0);
  assert.equal(lift(true, PAGE_FRAME.default), 7);
  assert.equal(lift(false, 0), 9);
  assert.equal(lift(true, 0), 16);
  assert.equal(geometry.firstRowTopOf(false, toolbarLightsCenter(true, 0)[1]), layout.pinnedTop - 16);
});

test("the first row sits as far below the lights as in the default layout, for every toolbar height and frame", () => {
  const spacing = lightsToFirstRow(false, PAGE_FRAME.default);
  assert.equal(spacing, layout.pinnedTop - LIGHTS_CENTER[1]);
  for (const compact of [false, true]) {
    for (let frame = PAGE_FRAME.min; frame <= PAGE_FRAME.max; frame++) {
      assert.equal(lightsToFirstRow(compact, frame), spacing, `compact ${compact}, frame ${frame}`);
    }
  }
});

test("the list still starts the same gap under the header", () => {
  for (const [compact, frame] of [[false, 9], [true, 9], [false, 0], [true, 0]]) {
    const lightsY = toolbarLightsCenter(compact, frame)[1];
    assert.equal(geometry.firstRowTopOf(false, lightsY) - geometry.sidebarHeaderOf(false, lightsY), geometry.listTopGap(false));
  }
});

test("with the address bar in the sidebar the lights are fixed and the header does not follow the toolbar", () => {
  for (const [compact, frame] of [[false, 9], [true, 9], [false, 0], [true, 0]]) {
    const lightsY = toolbarLightsCenter(compact, frame)[1];
    assert.equal(geometry.sidebarHeaderOf(true, lightsY), geometry.SIDEBAR_HEADER_WITH_FIELD);
    assert.equal(geometry.firstRowTopOf(true, lightsY), geometry.SIDEBAR_HEADER_WITH_FIELD + 6);
  }
  assert.equal(ARC_LIGHTS_CENTER[1], 24);
});
