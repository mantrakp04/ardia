import assert from "node:assert/strict";
import { test } from "node:test";
import { TAB_GROUP_COLORS } from "@ardia/core";
import { groupBoxAtRest, groupSurface, groupTint } from "./tokens.ts";
import { GROUP_COLORS } from "../../state/groups/tokens.ts";

const TOKENS = { groupFill: "rgba(255,255,255,0.1)", groupStroke: "rgba(255,255,255,0.1)" };

test("every colour a group can take draws its box at rest, in its own tint", () => {
  for (const color of TAB_GROUP_COLORS) {
    assert.ok(GROUP_COLORS[color], color);
    assert.equal(groupTint(color), GROUP_COLORS[color].hex, color);
    assert.equal(groupBoxAtRest(color), true, color);
    assert.notDeepEqual(groupSurface(color, TOKENS), { fill: TOKENS.groupFill, stroke: TOKENS.groupStroke }, color);
  }
});

test("a neutral group keeps Dia's look, its box only under the pointer, and None never draws one", () => {
  assert.equal(groupBoxAtRest(null), false);
  assert.equal(groupBoxAtRest(undefined), false);
  assert.equal(groupBoxAtRest("none"), false);
  assert.deepEqual(groupSurface(null, TOKENS), { fill: TOKENS.groupFill, stroke: TOKENS.groupStroke });
  assert.deepEqual(groupSurface("none", TOKENS), { fill: "transparent", stroke: "transparent" });
});
