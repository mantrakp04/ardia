import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { osVersion: "26.1", osBuild: "25B78" });
const { systemDetails } = await import("./details.ts");
const { resource } = await import("../telemetry/client.ts");
const windowsIds = (await import("../../lib/platformTerms.windows.ts")).PLATFORM_IDS;

test("on the Mac the attached system details keep the macos key and telemetry keeps os.type darwin", async () => {
  const details = await systemDetails();
  assert.equal(details.macos, "26.1 (25B78)");
  assert.equal(resource()["os.type"], "darwin");
});

test("the Windows OS key names its OS and takes no other detail's place", async () => {
  const details = await systemDetails();
  assert.ok(!(windowsIds.report in details));
  assert.equal(windowsIds.otel, "windows");
});
