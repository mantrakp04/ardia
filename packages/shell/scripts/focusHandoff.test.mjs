import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const focusHandoff = readFileSync(new URL("../ios/FocusHandoff.swift", import.meta.url), "utf8");

test("the key epoch moves in step with didBecomeKey, before the next key is tagged", () => {
  const observer = focusHandoff.match(/addObserver\(forName: NSWindow\.didBecomeKeyNotification[^)]*\)/)?.[0];
  assert.ok(observer, "FocusHandoff does not observe didBecomeKey");
  assert.ok(observer.includes("queue: nil"), `${observer} defers the epoch bump to a later turn of the main queue`);
});

test("an edit key's tag and its check read the same KeyEpochs", () => {
  assert.ok(focusHandoff.includes("keyEpochs.becameKey(window.windowNumber)"), "didBecomeKey does not feed KeyEpochs");
  const reads = focusHandoff.match(/keyEpochs\.epoch\(of: window\.windowNumber\)/g)?.length ?? 0;
  assert.equal(reads, 2, "the tag and the check must both read KeyEpochs");
});
