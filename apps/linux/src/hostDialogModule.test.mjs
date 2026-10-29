import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Linux shell exports and shared package Expo dialogs use one adapter", () => {
  const script = fileURLToPath(new URL("../scripts/dialog-module-production.mjs", import.meta.url));
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /share the production adapter/);
});
