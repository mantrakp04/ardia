import assert from "node:assert/strict";
import { test } from "node:test";
import { importProfile, Unlocks } from "../../../../../packages/expo-windows/src/import/importer.ts";
import { fakeHost } from "./fixtures/windowsHost.mjs";

const quiet = { progress() {}, cancelled: () => false };

test("Chrome autofill unlocks the key, counts what reached the vault and joins the cookies' token", async () => {
  const host = fakeHost({
    cookies: { count: 6, token: "t0k", undecryptable: 0, appBound: 0, dropped: 0 },
    autofill: { addresses: 3, cards: 2, lockedCards: 0, undecryptable: 1, appBound: 1, token: "t0k" },
  });
  const result = await importProfile(host, new Unlocks(), "chrome", "Default", ["cookies", "autofill"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.deepEqual([result.addressCount, result.cardCount, result.vaultToken], [3, 2, "t0k"]);
  assert.deepEqual(host.calls.find(([c]) => c === "autofill"), ["autofill", "chrome", "t0k"]);
  assert.deepEqual(result.warnings.map((w) => [w.kind, w.code]), [["autofill", "undecryptable"], ["autofill", "undecryptable"]]);
  assert.match(result.warnings[1].message, /1 card use Google Chrome's app-bound encryption/);
});

test("Autofill without the key keeps the addresses and says which cards stayed", async () => {
  const host = fakeHost({ unlocked: false, autofill: { addresses: 3, cards: 0, lockedCards: 3, undecryptable: 0, appBound: 0, token: "a1" } });
  const result = await importProfile(host, new Unlocks(), "chrome", "Default", ["autofill"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.deepEqual([result.addressCount, result.cardCount, result.vaultToken], [3, 0, "a1"]);
  assert.deepEqual(result.warnings.map((w) => [w.code, w.message]), [["locked", "3 saved cards need Google Chrome's key, which Windows couldn't unwrap"]]);
  assert.deepEqual(host.calls.find(([c]) => c === "autofill"), ["autofill", "chrome", ""]);
  const held = await importProfile(fakeHost({ autofill: { failure: "inUse", addresses: 0, cards: 0, lockedCards: 0, undecryptable: 0, appBound: 0 } }), new Unlocks(), "chrome", "Default", ["autofill"], {}, quiet);
  assert.deepEqual(held.failed, ["autofill"]);
  assert.match(held.warnings[0].message, /Google Chrome is holding Web Data/);
});

test("A profile without Web Data has no autofill to offer or import", async () => {
  const result = await importProfile(fakeHost(), new Unlocks(), "opera", ".", ["autofill"], {}, quiet);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.warnings.map((w) => w.code), ["empty"]);
});
