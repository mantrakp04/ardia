import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNowControl, switchCheckLine, switchOutcome, updaterBusy } from "./updateStatus.ts";

const state = (switchCheck, extra = {}) => ({
  available: true,
  configured: true,
  automaticChecks: true,
  automaticDownloads: true,
  canCheck: true,
  sessionInProgress: false,
  feedURL: null,
  lastCheck: null,
  version: "0.2.46-nightly.5",
  displayVersion: "0.2.46 Nightly 5",
  switchCheck,
  ...extra,
});

test("a switch stays followed until its check settles", () => {
  assert.equal(updaterBusy(state({ phase: "waiting", channel: "nightly" })), true);
  assert.equal(updaterBusy(state({ phase: "checking", channel: "nightly" })), true);
  assert.equal(updaterBusy(state({ phase: "found", channel: "nightly", version: "0.2.47 Nightly 1" })), false);
  assert.equal(updaterBusy(state(null, { sessionInProgress: true })), true);
  assert.equal(updaterBusy(state(null)), false);
  assert.equal(updaterBusy({ available: false }), false);
  assert.equal(updaterBusy(undefined), false);
});

test("Settings says what the switch's check found", () => {
  assert.equal(switchCheckLine(state({ phase: "checking", channel: "nightly" }), "Ardia"), "Checking Nightly…");
  assert.equal(switchCheckLine(state({ phase: "waiting", channel: "stable" }), "Ardia"), "Checking Stable once the current update finishes…");
  assert.equal(switchCheckLine(state({ phase: "found", channel: "nightly", version: "0.2.47 Nightly 1" }), "Ardia"), "Ardia 0.2.47 Nightly 1 is available on Nightly.");
  assert.equal(switchCheckLine(state({ phase: "upToDate", channel: "stable" }), "Ardia"), "You're up to date on Stable.");
  assert.equal(switchCheckLine(state({ phase: "failed", channel: "nightly" }), "Ardia"), "Couldn't check Nightly. Try Check Now.");
  assert.equal(switchCheckLine(state(null), "Ardia"), null);
});

test("going back to Stable from a newer nightly never reads as a downgrade", () => {
  assert.equal(
    switchCheckLine(state({ phase: "newerThanLatest", channel: "stable" }), "Ardia"),
    "0.2.46 Nightly 5 is newer than the latest Stable, so Ardia stays on it until a newer Stable ships.",
  );
});

test("each settled switch counts as offered, up to date or failed", () => {
  assert.equal(switchOutcome({ phase: "found", channel: "nightly" }), "offered");
  assert.equal(switchOutcome({ phase: "upToDate", channel: "stable" }), "upToDate");
  assert.equal(switchOutcome({ phase: "newerThanLatest", channel: "stable" }), "upToDate");
  assert.equal(switchOutcome({ phase: "failed", channel: "stable" }), "failed");
  assert.equal(switchOutcome({ phase: "checking", channel: "stable" }), null);
  assert.equal(switchOutcome(null), null);
});

test("Check Now shows a check in progress as progress, never as a dimmed button", () => {
  for (const phase of ["waiting", "checking"]) {
    for (const canCheck of [true, false]) {
      const control = checkNowControl(state({ phase, channel: "nightly" }, { canCheck, sessionInProgress: true }));
      assert.deepEqual(control, { title: "Checking…", checking: true, disabled: false, pressable: true }, `${phase}, canCheck ${canCheck}`);
    }
  }
  assert.deepEqual(checkNowControl(state(null, { canCheck: false, sessionInProgress: true })), { title: "Checking…", checking: true, disabled: false, pressable: false });
  assert.deepEqual(checkNowControl(state({ phase: "found", channel: "nightly" }, { sessionInProgress: true })), { title: "Check Now", checking: false, disabled: false, pressable: true });
  assert.deepEqual(checkNowControl(state({ phase: "upToDate", channel: "stable" })), { title: "Check Now", checking: false, disabled: false, pressable: true });
  assert.equal(checkNowControl(state(null, { canCheck: false })).disabled, true);
  assert.equal(checkNowControl(state(null, { configured: false, canCheck: false })).disabled, false);
  assert.equal(checkNowControl({ available: false }).checking, false);
});
