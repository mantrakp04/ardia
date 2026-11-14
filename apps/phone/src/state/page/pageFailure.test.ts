import assert from "node:assert/strict";
import { test } from "node:test";
import { failureIcon, holdFailure, NO_FAILURE, retriesWhenOnline, type FailureHold } from "./pageFailure.ts";

test("a crashed page shows a warning, an offline one the no-wifi mark, any other failure a globe", () => {
  assert.equal(failureIcon({ kind: "crashed", reason: null, title: "This Page Stopped Working", message: "" }), "crashed");
  assert.equal(failureIcon({ kind: "network", reason: "offline", title: "You’re Offline", message: "" }), "offline");
  assert.equal(failureIcon({ kind: "network", reason: "timedOut", title: "This Webpage Couldn’t Load", message: "" }), "network");
});

test("only an offline page reloads by itself once the phone is back online", () => {
  assert.equal(retriesWhenOnline({ kind: "network", reason: "offline", title: "", message: "" }), true);
  assert.equal(retriesWhenOnline({ kind: "network", reason: "hostNotFound", title: "", message: "" }), false);
  assert.equal(retriesWhenOnline({ kind: "crashed", reason: null, title: "", message: "" }), false);
});

test("a retried page keeps the failure screen up until the reload has loaded, so the WebView's own error page never shows", () => {
  const offline = { kind: "network" as const, reason: "offline" as const, title: "You’re Offline", message: "" };
  let hold: FailureHold = NO_FAILURE;
  const step = (failure: typeof offline | null, isLoading: boolean) => (hold = holdFailure(hold, failure, isLoading));
  step(null, true);
  step(offline, false);
  assert.equal(hold.shown, offline);
  step(null, false);
  assert.equal(hold.shown, offline, "the reload has cleared the failure but not started yet");
  step(null, true);
  assert.equal(hold.shown, offline, "still loading");
  step(null, false);
  assert.equal(hold.shown, null, "the reload finished and the page shows");
});

test("a reload that fails again shows the new failure, and a page that never failed shows nothing", () => {
  const offline = { kind: "network" as const, reason: "offline" as const, title: "You’re Offline", message: "" };
  const timedOut = { kind: "network" as const, reason: "timedOut" as const, title: "This Webpage Couldn’t Load", message: "" };
  let hold = holdFailure(NO_FAILURE, offline, false);
  hold = holdFailure(hold, null, true);
  hold = holdFailure(hold, timedOut, false);
  assert.deepEqual(hold, { shown: timedOut, sawLoad: false });
  hold = holdFailure(hold, timedOut, false);
  assert.equal(hold.shown, timedOut);
  assert.equal(holdFailure(NO_FAILURE, null, true), NO_FAILURE);
  assert.equal(holdFailure(NO_FAILURE, null, false), NO_FAILURE);
});
