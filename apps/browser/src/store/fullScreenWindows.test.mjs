import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

test("a window's full screen survives a relaunch, stamped in the order the windows entered it", async () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startPersistence();
  const a = S().createWindow({ url: "a.com" });
  const b = S().createWindow({ url: "b.com" });
  const c = S().createWindow({ url: "c.com" });
  S().setWindowFullScreen(b, true);
  await tick();
  S().setWindowFullScreen(a, true);
  const stamp = S().windows[b].fullScreen;
  S().setWindowFullScreen(b, true);
  assert.equal(S().windows[b].fullScreen, stamp, "entering again keeps the first stamp");
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  const w = S().windows;
  assert.ok(w[b].fullScreen < w[a].fullScreen, "b entered full screen before a");
  assert.equal(w[c].fullScreen, undefined);
  S().setWindowFullScreen(b, false);
  assert.equal("fullScreen" in S().windows[b], false);
});
