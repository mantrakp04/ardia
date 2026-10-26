import assert from "node:assert/strict";
import { test } from "node:test";
import { launchVariables, mergeLaunchEnv } from "./launchEnv.mjs";

test("an extra ARDIA_INSTANCE adds to the defaults instead of replacing them", () => {
  const base = { ARDIA_BACKGROUND: "1", ...launchVariables({ instance: { updateFeed: "http://127.0.0.1:1/appcast.xml", allowOcclusion: true } }) };
  const merged = mergeLaunchEnv(base, { ARDIA_INSTANCE: "chromiumSwitches=--enable-features=A,B --x" });
  assert.equal(merged.ARDIA_BACKGROUND, "1");
  assert.equal(merged.ARDIA_INSTANCE, "updateFeed=http://127.0.0.1:1/appcast.xml,allowOcclusion,chromiumSwitches=--enable-features=A,B --x");
});

test("a later entry for the same key wins, and test, trace and switch lists merge the same way", () => {
  const merged = mergeLaunchEnv(
    launchVariables({ instance: { downloadsDir: "/a" }, test: { reauth: "granted" }, trace: ["pip"], switchOverrides: { launchTab: false } }),
    { ARDIA_INSTANCE: "downloadsDir=/b", ARDIA_TEST: "keychain=file", ARDIA_TRACE: "visibility,pip", ARDIA_SWITCHES: "launchTab=on,webkitSignIn=on" },
  );
  assert.equal(merged.ARDIA_INSTANCE, "downloadsDir=/b");
  assert.equal(merged.ARDIA_TEST, "reauth=granted,keychain=file");
  assert.equal(merged.ARDIA_TRACE, "pip,visibility");
  assert.equal(merged.ARDIA_SWITCHES, "launchTab=on,webkitSignIn=on");
});

test("repeated entries of one variable each add their keys", () => {
  const merged = mergeLaunchEnv({ ARDIA_INSTANCE: "allowAudio" }, { ARDIA_INSTANCE: "allowOcclusion" }, { ARDIA_TEST: "reauth=granted" }, { ARDIA_TEST: "contextMenu" });
  assert.equal(merged.ARDIA_INSTANCE, "allowAudio,allowOcclusion");
  assert.equal(merged.ARDIA_TEST, "reauth=granted,contextMenu");
});

test("other variables pass through, a null one included (it unsets the variable)", () => {
  assert.deepEqual(mergeLaunchEnv({ HOME: "/h", ARDIA_DATA_DIR: "/d" }, { ARDIA_DATA_DIR: null }), { HOME: "/h", ARDIA_DATA_DIR: null });
});
