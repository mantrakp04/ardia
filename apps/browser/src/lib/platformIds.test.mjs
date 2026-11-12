import assert from "node:assert/strict";
import { test } from "node:test";
const mac = await import("./platformTerms.ts");
const windows = await import("./platformTerms.windows.ts");
const macFeatures = (await import("./platformFeatures.ts")).PLATFORM_FEATURES;
const windowsFeatures = (await import("./platformFeatures.windows.ts")).PLATFORM_FEATURES;

test("the OS ids keep the Mac's macos report key and darwin os.type, and name Windows on Windows", () => {
  assert.deepEqual(mac.PLATFORM_IDS, { report: "macos", otel: "darwin" });
  assert.deepEqual(windows.PLATFORM_IDS, { report: "windows_os", otel: "windows" });
});

test("only the Mac reports memory pressure", () => {
  assert.equal(macFeatures.memoryPressure, true);
  assert.equal(windowsFeatures.memoryPressure, false);
});
