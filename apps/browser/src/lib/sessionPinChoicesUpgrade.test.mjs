import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock } from "@ardia/sync";
import { sessionWithPinChoiceStamps } from "./sessionPinChoicesUpgrade.ts";

test("legacy pin timestamps keep the upstream v9 clock encoding and survive a second migration", () => {
  for (const stamp of [-1, 0, 0.5, 1, 1900000000000, 1900000000000.5]) {
    const source = { pinChoices: { school: { pin: stamp, kept: "00000zzzz.0001.device", damaged: null } } };
    const migrated = sessionWithPinChoiceStamps(source);
    assert.equal(migrated.pinChoices.school.pin, new Clock("", null, () => stamp).tick());
    assert.equal(migrated.pinChoices.school.kept, source.pinChoices.school.kept);
    assert.equal(migrated.pinChoices.school.damaged, undefined);
    assert.deepEqual(sessionWithPinChoiceStamps(migrated), migrated);
    assert.equal(source.pinChoices.school.pin, stamp);
  }
});
