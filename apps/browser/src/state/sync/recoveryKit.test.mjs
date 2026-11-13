import assert from "node:assert/strict";
import { test } from "node:test";

const answers = [];
globalThis.acTestNativeModules = { ArdiaSync: { qrCode: () => answers.shift()() } };

const { recoveryQrCode, takeSyncCodeCounts } = await import("./recoveryKit.ts");

test("a shown code counts once, and a declined or failed request counts as declined and shows nothing", async () => {
  answers.push(async () => "data:image/png;base64,AAAA", async () => null, async () => Promise.reject(new Error("locked")));
  assert.equal(await recoveryQrCode(), "data:image/png;base64,AAAA");
  assert.equal(await recoveryQrCode(), null);
  assert.equal(await recoveryQrCode(), null);
  assert.deepEqual(takeSyncCodeCounts(), { sync_codes_shown: 1, sync_codes_declined: 2 });
  assert.deepEqual(takeSyncCodeCounts(), { sync_codes_shown: 0, sync_codes_declined: 0 }, "taking the counts starts them again at zero");
});
