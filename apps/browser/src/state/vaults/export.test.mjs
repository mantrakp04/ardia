import assert from "node:assert/strict";
import { test } from "node:test";
const native = await import("../../test-native/index.ts");
const { exportManagerPasswords, EXPORT_FAILED, exportedLine } = await import("./export.ts");

const asked = [];
const answer = (confirmed) => async (options) => (asked.push(options), { confirmed });

test("export asks first and does nothing when the person cancels", async () => {
  native.vaultFakes.exports = [];
  assert.equal(await exportManagerPasswords("bitwarden", answer(false)), "");
  assert.deepEqual(native.vaultFakes.exports, []);
  assert.match(asked.at(-1).message, /Anyone who can open the file can read your passwords\./);
  assert.equal(asked.at(-1).confirmTitle, "Export");
});

test("a confirmed export runs natively and reports only the count", async () => {
  native.vaultFakes.exports = [];
  native.vaultFakes.nextExport = { saved: true, count: 3 };
  assert.equal(await exportManagerPasswords("bitwarden", answer(true)), exportedLine(3));
  assert.deepEqual(native.vaultFakes.exports, ["bitwarden"]);
  assert.match(exportedLine(1), /^Exported 1 password\./);
});

test("a declined owner check or cancelled panel says nothing; a failed write says so", async () => {
  native.vaultFakes.nextExport = { saved: false, count: 0, declined: true };
  assert.equal(await exportManagerPasswords("protonpass", answer(true)), "");
  native.vaultFakes.nextExport = { saved: false, count: 0 };
  assert.equal(await exportManagerPasswords("protonpass", answer(true)), EXPORT_FAILED);
});
