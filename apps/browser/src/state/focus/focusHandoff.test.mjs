import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { settlingCommandFocus } = await import("./focusHandoff.ts");
const { expectFocus, commandBarFocus } = await import("./focusClaims.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");

const S = () => useBrowser.getState();

function recordFocusMessages() {
  const log = [];
  const shell = shellNativeModules.ArdiaFocus;
  shell.ackFocusMove = (generation) => Promise.resolve(log.push(["ack", generation]));
  shell.cancelFocusMove = (generation, restoring) => Promise.resolve(log.push(["cancel", generation, restoring]));
  shell.claimFocus = (generation, tag) => Promise.resolve(log.push(["claim", generation, tag]));
  return log;
}

const command = (windowId, focusGeneration) => ({ command: "newTab", arg: null, windowId, focusGeneration });

test("a command tells native it was picked up before it runs, so a busy app keeps the held keys", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const log = recordFocusMessages();
  let ranWith;
  settlingCommandFocus(command(w, 31), () => {
    ranWith = [...log];
    expectFocus(w, commandBarFocus);
  });
  assert.deepEqual(ranWith, [["ack", 31]]);
  assert.deepEqual(log, [["ack", 31]]);
});

test("a command that expects nothing is acknowledged, then cancelled", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const log = recordFocusMessages();
  settlingCommandFocus(command(w, 32), () => {});
  assert.deepEqual(log, [["ack", 32], ["cancel", 32, true]]);
});

test("a command that throws was still acknowledged first", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const log = recordFocusMessages();
  assert.throws(() => settlingCommandFocus(command(w, 33), () => { throw new Error("boom"); }), /boom/);
  assert.deepEqual(log, [["ack", 33], ["cancel", 33, true]]);
});

test("a command without a generation sends nothing", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "a.com" });
  const log = recordFocusMessages();
  let ran = 0;
  settlingCommandFocus(command(w, null), () => ran++);
  assert.equal(ran, 1);
  assert.deepEqual(log, []);
});

test("a command for a window that is gone is cancelled without an acknowledgement", () => {
  S().hydrate({});
  const log = recordFocusMessages();
  settlingCommandFocus(command("missing", 34), () => {});
  assert.deepEqual(log, [["cancel", 34, false]]);
});
