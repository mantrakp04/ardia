import assert from "node:assert/strict";
import { test } from "node:test";
import { copy, copyTable, selectCopy } from "./platformCopy.ts";

test("the iPhone table says iPhone, iCloud Drive, Keychain and Safari where Android says phone, folder and Ardia", () => {
  const android = copyTable("android");
  const ios = copyTable("ios");
  assert.equal(ios.thisDevice, "This iPhone");
  assert.equal(android.thisDevice, "This Phone");
  assert.match(ios.phraseStays, /Keychain/);
  assert.match(ios.folderUnavailable, /iCloud Drive/);
  assert.match(ios.filterRulesUnsupported, /Safari/);
  assert.equal(ios.alreadyPinnedToast, "Already Pinned to Your Mac");
  assert.equal(android.alreadyPinnedToast, "Pinned to Your Mac");
  assert.deepEqual([ios.readerSerif.label, ios.readerSans.label], ["New York", "San Francisco"]);
  for (const table of [android, ios]) for (const value of Object.values(table)) if (typeof value === "string") assert.ok(value.trim());
  for (const [key, value] of Object.entries(android)) if (typeof value === "string" && /phone/i.test(value)) assert.match(String(ios[key as keyof typeof ios]), /iPhone|iCloud|Keychain/);
});

test("the table follows the platform it is chosen for, and anything but iOS reads as Android", () => {
  selectCopy("ios");
  assert.equal(copy().thisDevice, "This iPhone");
  selectCopy("web");
  assert.equal(copy().thisDevice, "This Phone");
  selectCopy("android");
});
