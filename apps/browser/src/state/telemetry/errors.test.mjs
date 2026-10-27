import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
const { setSharing } = await import("./client.ts");
const { captureException, reportNativeCrashes } = await import("./errors.ts");

globalThis.fetch = async () => ({ status: 200 });
setSharing(true, "settings");

const queued = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? "{}").events?.filter((e) => e.event === "$exception") ?? [];

test("a JS error is on disk the moment it's captured, so a crash right after can't lose it", () => {
  const before = queued().length;
  captureException(new TypeError("Attempting to run JS driven animation on a native node"), "react");
  const events = queued();
  assert.equal(events.length, before + 1);
  const props = events.at(-1).properties;
  assert.deepEqual(props.$exception_types, ["TypeError"]);
  assert.deepEqual(props.$exception_values, ["Attempting to run JS driven animation on a native node"]);
  assert.equal(props.$exception_list[0].value, "Attempting to run JS driven animation on a native node");
});

test("a native crash names its exception, reason and the app's images at the top level", async () => {
  stub.shellNativeModules.ArdiaApp.crashReports = async () => [
    {
      time: Date.now(),
      appVersion: "0.3.0",
      exceptionType: "EXC_CRASH",
      signal: "SIGABRT",
      exceptionName: "RCTFatalException",
      exceptionReason: "Unhandled JS Exception: moved to \"native\" earlier, js engine: hermes, stack:\nGroupBlock@1:2",
      frames: [{ image: "Chromium Framework", symbol: "ArdiaCoreMain", symbolOffset: 66417332, offset: 0x41a36e8 }],
      exceptionFrames: [{ image: "Ardia", offset: 0x38eab8 }],
      images: [{ name: "Ardia", uuid: "1c77ef99-77d4-3de8-9ba2-6929e276bc60" }],
    },
  ];
  await reportNativeCrashes();
  const props = queued().at(-1).properties;
  assert.equal(props.source, "native_crash");
  assert.equal(props.objc_exception, "RCTFatalException");
  assert.deepEqual(props.$exception_types, ["RCTFatalException", "EXC_CRASH"]);
  assert.deepEqual(props.$exception_values, ["Unhandled JS Exception: moved to <text>", "EXC_CRASH (SIGABRT)"]);
  assert.deepEqual(props.crash_images, [{ name: "Ardia", uuid: "1c77ef99-77d4-3de8-9ba2-6929e276bc60" }]);
  assert.equal(props.$exception_list[0].stacktrace.frames[0].function, "Ardia + 0x38eab8");
  assert.equal(props.$exception_list[1].stacktrace.frames[0].function, "Chromium Framework + 0x41a36e8");
  assert.equal(props.$geoip_disable, true);
});
