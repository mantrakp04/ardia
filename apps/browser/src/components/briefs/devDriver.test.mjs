import assert from "node:assert/strict";
import test from "node:test";
import { briefHoverSnapshot, registerBriefHover } from "./devDriver.ts";

test("hover probe cleanup cannot remove a replacement registration", async () => {
  const old = registerBriefHover("window-a:instance-a", { hovered: false, measure: async () => [1, 2, 20, 20] });
  const current = registerBriefHover("window-a:instance-a", { hovered: true, measure: async () => [3, 4, 20, 20] });
  old();
  assert.deepEqual(await briefHoverSnapshot(), [{ key: "window-a:instance-a", hovered: true, frame: [3, 4, 20, 20] }]);
  current();
  assert.deepEqual(await briefHoverSnapshot(), []);
});

test("matching sources remain independently measurable across mounted instances", async () => {
  const first = registerBriefHover("window-a:instance-a:https://github.com/owner/repo/pull/1", { hovered: true, measure: async () => [10, 20, 24, 24] });
  const repeated = registerBriefHover("window-a:instance-b:https://github.com/owner/repo/pull/1", { hovered: false, measure: async () => [30, 40, 24, 24] });
  const otherWindow = registerBriefHover("window-b:instance-a:https://github.com/owner/repo/pull/1", { hovered: false, measure: async () => [50, 60, 24, 24] });
  assert.equal((await briefHoverSnapshot()).length, 3);
  repeated();
  assert.equal((await briefHoverSnapshot()).length, 2);
  first();
  otherWindow();
  assert.deepEqual(await briefHoverSnapshot(), []);
});
