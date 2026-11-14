import assert from "node:assert/strict";
import { test } from "node:test";
import { accessAfterAsking, accessOf, cameraErrorAccess } from "./cameraAccess.ts";

test("the scanner's permission reads as the scan screen's states", () => {
  assert.equal(accessOf({ status: "granted", canAskAgain: true }), "granted");
  assert.equal(accessOf({ status: "undetermined", canAskAgain: true }), "undetermined");
  assert.equal(accessOf({ status: "denied", canAskAgain: true }), "undetermined");
  assert.equal(accessOf({ status: "denied", canAskAgain: false }), "denied");
  assert.equal(accessOf({ status: "unsupported", canAskAgain: false }), "unavailable");
});

test("a refused request is denied, and camera errors leave the scanner", () => {
  assert.equal(accessAfterAsking({ status: "denied", canAskAgain: true }), "denied");
  assert.equal(accessAfterAsking({ status: "granted", canAskAgain: true }), "granted");
  assert.equal(cameraErrorAccess("permission"), "denied");
  assert.equal(cameraErrorAccess("camera"), "unavailable");
  assert.equal(cameraErrorAccess("unsupported"), "unavailable");
});
