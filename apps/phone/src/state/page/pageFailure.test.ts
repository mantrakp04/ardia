import assert from "node:assert/strict";
import { test } from "node:test";
import { failureIcon, retriesWhenOnline } from "./pageFailure.ts";

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
