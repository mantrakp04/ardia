import assert from "node:assert/strict";
import { test } from "node:test";
const { WHATS_SENT, periodicNote } = await import("./copy.ts");

const MAC_NOTE =
  "Every 10 minutes Ardia notes on this Mac its tab, window and profile counts, its memory use, rough free disk space, the Mac's memory pressure and how long it has been open. That note is sent only with a crash report, or at the next launch after Ardia didn't quit cleanly, with whether the Mac restarted since. Turning sharing off or deleting a profile erases it";

test("the Mac's What's Sent keeps its ten-minute note word for word", () => {
  assert.ok(WHATS_SENT.some((group) => group.items.includes(MAC_NOTE)));
});

test("memory pressure is named only where the platform measures it", () => {
  assert.equal(periodicNote("Mac", true), MAC_NOTE);
  const windows = periodicNote("PC", false);
  assert.ok(!windows.includes("memory pressure"));
  assert.ok(windows.startsWith("Every 10 minutes Ardia notes on this PC its tab, window and profile counts, its memory use, rough free disk space and how long it has been open."));
});
