import assert from "node:assert/strict";
import { test } from "node:test";
import { cancelAbandonedFocus, claimFocusTag, commandBarFocus, expectFocus, findFocus, runFocusMove } from "./focusClaims.ts";
import { shellNativeModules } from "../../test-native/shell.ts";

function setFocusSenders(claim, cancel) {
  const shell = shellNativeModules.ArdiaFocus;
  shell.claimFocus = (generation, tag) => Promise.resolve(claim(generation, tag));
  shell.cancelFocusMove = (generation, restoring) => Promise.resolve(cancel(generation, restoring));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("a late claim from Find can't take the command bar's newer request", async () => {
  const sent = [];
  setFocusSenders((generation, tag) => sent.push([generation, tag]), () => {});
  runFocusMove(1, "w", "src", () => expectFocus("w", findFocus("t")));
  runFocusMove(2, "w", "src", () => expectFocus("w", commandBarFocus));
  claimFocusTag("w", findFocus("t"), () => 11);
  claimFocusTag("w", commandBarFocus, () => 22);
  await settle();
  assert.deepEqual(sent, [[2, 22]]);
});

test("a destination claims only while its own request is the window's newest", async () => {
  const sent = [];
  setFocusSenders((generation, tag) => sent.push([generation, tag]), () => {});
  runFocusMove(3, "w", "src", () => expectFocus("w", commandBarFocus));
  claimFocusTag("w", commandBarFocus, () => 33);
  runFocusMove(4, "w", "src", () => expectFocus("w", findFocus("t")));
  await settle();
  assert.deepEqual(sent, []);
  claimFocusTag("w", findFocus("t"), () => 44);
  await settle();
  assert.deepEqual(sent, [[4, 44]]);
});

test("a run that expects nothing reports it, so the command cancels", () => {
  assert.equal(runFocusMove(5, "w", "src", () => {}), false);
  assert.equal(runFocusMove(6, "w", "src", () => expectFocus("other", commandBarFocus)), false);
  assert.equal(runFocusMove(7, "w", "src", () => expectFocus("w", commandBarFocus)), true);
});

test("a request none of whose destinations can still take focus is cancelled once, and can't be claimed after", async () => {
  const sent = [], cancelled = [];
  setFocusSenders((generation, tag) => sent.push([generation, tag]), (generation, restoring) => cancelled.push(restoring ? generation : -generation));
  runFocusMove(8, "w", "src", () => expectFocus("w", commandBarFocus));
  cancelAbandonedFocus(() => true, () => "src");
  assert.deepEqual(cancelled, []);
  cancelAbandonedFocus((windowId, destination) => destination !== commandBarFocus, () => "src");
  cancelAbandonedFocus(() => false, () => "src");
  assert.deepEqual(cancelled, [8]);
  claimFocusTag("w", commandBarFocus, () => 88);
  await settle();
  assert.deepEqual(sent, []);
});

test("nothing is cancelled for the window whose command is still running", () => {
  const cancelled = [];
  setFocusSenders(() => {}, (generation, restoring) => cancelled.push(restoring ? generation : -generation));
  runFocusMove(9, "w", "src", () => {
    expectFocus("w", commandBarFocus);
    cancelAbandonedFocus(() => false, () => "src");
  });
  assert.deepEqual(cancelled, []);
  cancelAbandonedFocus(() => false, () => "src");
  assert.deepEqual(cancelled, [9]);
});

test("a cancelled request restores its source only while the source tab is still shown", () => {
  const cancelled = [];
  setFocusSenders(() => {}, (generation, restoring) => cancelled.push([generation, restoring]));
  runFocusMove(10, "w", "src", () => expectFocus("w", commandBarFocus));
  cancelAbandonedFocus(() => false, () => "other");
  runFocusMove(11, "w", "src", () => expectFocus("w", commandBarFocus));
  cancelAbandonedFocus(() => false, () => "src");
  assert.deepEqual(cancelled, [[10, false], [11, true]]);
});

test("a claimed request is still cancelled when its tab stops being shown before native delivers", async () => {
  const sent = [], cancelled = [];
  setFocusSenders((generation, tag) => sent.push([generation, tag]), (generation, restoring) => cancelled.push([generation, restoring]));
  runFocusMove(12, "w", "src", () => expectFocus("w", findFocus("a")));
  claimFocusTag("w", findFocus("a"), () => 120);
  await settle();
  assert.deepEqual(sent, [[12, 120]]);
  cancelAbandonedFocus((windowId, destination) => destination === findFocus("a"), () => "a");
  assert.deepEqual(cancelled, []);
  cancelAbandonedFocus((windowId, destination) => destination === findFocus("b"), () => "b");
  assert.deepEqual(cancelled, [[12, false]]);
  claimFocusTag("w", findFocus("a"), () => 121);
  await settle();
  assert.deepEqual(sent, [[12, 120]]);
});
