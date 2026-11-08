import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const { createWindowSync } = await import("./windowSync.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const EXTERNAL = "37D8832A-2D66-02CA-B9F7-8F30A301B230";
const OTHER = "9F3A1C54-7B1E-4E55-A0C2-6D0E2B7A9C11";
const MAIN_FRAME = [100, 100, 800, 600];

function fakePort() {
  const calls = [];
  let listener = () => {};
  const port = {
    open: (id, options, lightsCenter) => calls.push(["open", id, options, lightsCenter]),
    close: (id) => calls.push(["close", id]),
    setTitle: (id, title) => calls.push(["setTitle", id, title]),
    windowIds: async () => [],
    restoreFullScreen: (ids, focus) => calls.push(["restoreFullScreen", ids, focus]),
    onEvent: (l) => void (listener = l),
    releaseProfile: (profile) => calls.push(["releaseProfile", profile]),
  };
  return { port, emit: (e) => listener(e), opens: () => calls.filter((c) => c[0] === "open") };
}

function start(native) {
  const sync = createWindowSync({
    port: native.port,
    getState: S,
    isQuitting: () => false,
    lightsCenter: () => [2, 2],
    isUtilityWindow: () => false,
  });
  sync.listen();
  return sync;
}

test("a window full screen on an external display reopens naming that display, not just its old frame", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const a = S().createWindow({ url: "a.com" });
  const b = S().createWindow({ url: "b.com" });
  const before = fakePort();
  start(before);
  before.emit({ type: "frame", id: a, frame: MAIN_FRAME });
  before.emit({ type: "frame", id: b, frame: MAIN_FRAME });
  before.emit({ type: "fullScreen", id: b, on: true, display: EXTERNAL });
  assert.equal(S().windows[b].display, EXTERNAL);
  assert.equal(S().windows[a].display, undefined);
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.equal(S().windows[b].display, EXTERNAL, "the display is part of the saved session");
  const after = fakePort();
  start(after).sync(S());
  const opened = Object.fromEntries(after.opens().map((c) => [c[1], c[2]]));
  assert.deepEqual(opened[b].frame, MAIN_FRAME);
  assert.equal(opened[b].display, EXTERNAL);
  assert.equal("display" in opened[a], false, "a window that was not full screen opens exactly as before");
});

test("a full screen window carried to another display keeps its place in line, and leaving full screen frees it", () => {
  stub.docs.clear();
  S().hydrate({});
  const a = S().createWindow({ url: "a.com" });
  const native = fakePort();
  start(native);
  native.emit({ type: "fullScreen", id: a, on: true, display: EXTERNAL });
  const stamp = S().windows[a].fullScreen;
  assert.ok(stamp > 0);
  native.emit({ type: "fullScreen", id: a, on: true, display: OTHER });
  assert.equal(S().windows[a].display, OTHER);
  assert.equal(S().windows[a].fullScreen, stamp, "moving between displays keeps the order it entered full screen in");
  native.emit({ type: "fullScreen", id: a, on: false });
  assert.equal("fullScreen" in S().windows[a], false);
  assert.equal("display" in S().windows[a], false, "a window that left full screen is no longer tied to a display");
});

test("a full screen event without a display leaves the window opening exactly as before", () => {
  stub.docs.clear();
  S().hydrate({});
  const a = S().createWindow({ url: "a.com" });
  const native = fakePort();
  start(native);
  native.emit({ type: "fullScreen", id: a, on: true });
  assert.ok(S().windows[a].fullScreen > 0);
  assert.equal("display" in S().windows[a], false);
  const reopened = fakePort();
  start(reopened).sync(S());
  assert.equal("display" in reopened.opens()[0][2], false);
});
