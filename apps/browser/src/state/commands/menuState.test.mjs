import assert from "node:assert/strict";
import { test } from "node:test";
const { menuState } = await import("./menuState.ts");
const { useBrowser } = await import("../browser/store.ts");

test("while a performance recording runs, Help offers Stop and Discard instead of Record", () => {
  const idle = menuState(useBrowser.getState());

  useBrowser.getState().setPerformanceRecording(true);
  const recording = menuState(useBrowser.getState());
  useBrowser.getState().setPerformanceRecording(false);

  assert.equal(idle.titles.recordPerformanceIssue, undefined);
  assert.ok(idle.disabled.includes("discardPerformanceRecording"));
  assert.equal(recording.titles.recordPerformanceIssue, "Stop Performance Recording");
  assert.ok(!recording.disabled.includes("discardPerformanceRecording"));
});
