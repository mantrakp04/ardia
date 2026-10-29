import assert from "node:assert/strict";
import { test } from "node:test";
import { CAST_UNAVAILABLE_TITLE, linuxMediaCall } from "./hostCast.ts";
import { resolveHostModule } from "./hostModules.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { useToasts } from "../../browser/src/state/app/toasts.ts";

function host(calls) {
  return {
    bootstrap: { capabilities: [], nativeModules: {} },
    call: (name, profile, args) => { calls.push([name, profile, args]); return Promise.resolve("null"); },
    invoke: () => Promise.resolve(null),
    onEvent: () => {},
  };
}

test("casting answers with an explicit unavailable state instead of a silent rejection", async () => {
  useBrowser.getState().hydrate({});
  const windowId = useBrowser.getState().createWindow({ url: "https://cast.ardia.test/" });
  const tabId = useBrowser.getState().windows[windowId].tabIds[0];
  useToasts.setState({ toasts: {} });
  assert.equal(await linuxMediaCall("showCastDialog", JSON.stringify({ tabId })), "false");
  assert.equal(useToasts.getState().toasts[windowId]?.title, CAST_UNAVAILABLE_TITLE);
  assert.equal(await linuxMediaCall("watchCastRoutes", JSON.stringify({ profile: "" })), "null");
  for (const verb of ["startCasting", "stopCasting", "closeCastDialog", "terminateCastRoute", "changeCaptureSource", "stopCapture"]) {
    await assert.rejects(linuxMediaCall(verb, "{}"), (error) => error.code === "ERR_UNAVAILABLE", verb);
  }
  assert.equal(linuxMediaCall("selectDevice", "{}"), undefined);
});

test("the media domain keeps reaching the host for everything else", async () => {
  const calls = [];
  const call = resolveHostModule(host(calls), "ArdiaMedia", "call");
  assert.equal(await call("selectDevice", "", JSON.stringify({ id: 1, index: 0 })), "null");
  assert.deepEqual(calls.map(([name]) => name), ["media.selectDevice"]);
  assert.equal(await call("showCastDialog", "", JSON.stringify({ tabId: "missing" })), "false");
  assert.deepEqual(calls.map(([name]) => name), ["media.selectDevice"]);
});
