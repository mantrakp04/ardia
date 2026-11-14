import assert from "node:assert/strict";
import { test } from "node:test";

const { noteDragsEnded, takeStuckDragCounts } = await import("./stuckDrags.ts");

test("the engine's running totals turn into counts since the last take, each kind on its own", () => {
  noteDragsEnded(undefined);
  assert.deepEqual(takeStuckDragCounts(), { stuck_drags_ended_owner_gone: 0, stuck_drags_ended_debugger: 0, stuck_drags_ended_refused: 0 });
  noteDragsEnded({ ownerGone: 2, debuggerUnowned: 0, nativeRefused: 1 });
  noteDragsEnded({ ownerGone: 2, debuggerUnowned: 0, nativeRefused: 1 });
  noteDragsEnded({ ownerGone: 3, debuggerUnowned: 1, nativeRefused: 1 });
  assert.deepEqual(takeStuckDragCounts(), { stuck_drags_ended_owner_gone: 3, stuck_drags_ended_debugger: 1, stuck_drags_ended_refused: 1 });
  assert.deepEqual(takeStuckDragCounts(), { stuck_drags_ended_owner_gone: 0, stuck_drags_ended_debugger: 0, stuck_drags_ended_refused: 0 });
});

test("a status that arrives out of order never counts a drag twice or takes one back", () => {
  noteDragsEnded({ ownerGone: 5, debuggerUnowned: 1, nativeRefused: 1 });
  noteDragsEnded({ ownerGone: 4, debuggerUnowned: 1, nativeRefused: 1 });
  noteDragsEnded({ ownerGone: 5, debuggerUnowned: 1, nativeRefused: 2 });
  assert.deepEqual(takeStuckDragCounts(), { stuck_drags_ended_owner_gone: 2, stuck_drags_ended_debugger: 0, stuck_drags_ended_refused: 1 });
});
