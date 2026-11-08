import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
stub.docs.set("telemetry.json", JSON.stringify({ version: 99, sharing: true, installId: "switcher", decidedAt: 1, askDoneAt: 1, crashCursor: 0, lastVersion: null, sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
client.loadChoice();
const { noteSwitcherPress, switcherSwitchProperties } = await import("./switcherPresses.ts");

test("a switch with no switcher press says it came from elsewhere", () => {
  assert.deepEqual(switcherSwitchProperties("w", "a", 1_000), { via_switcher: false });
});

test("a single switcher press is not a correction and carries the icons flag", () => {
  noteSwitcherPress("w", "a", true, 10_000);
  assert.deepEqual(switcherSwitchProperties("w", "a", 10_050), { via_switcher: true, switcher_icons: true, switcher_corrected: false });
});

test("pressing a different profile within 2 s counts as a corrected mis-tap", () => {
  noteSwitcherPress("w", "b", false, 20_000);
  switcherSwitchProperties("w", "b", 20_050);
  noteSwitcherPress("w", "c", false, 21_500);
  assert.deepEqual(switcherSwitchProperties("w", "c", 21_550), { via_switcher: true, switcher_icons: false, switcher_corrected: true });
});

test("a second press after 2 s, to the same profile or in another window is not a correction", () => {
  noteSwitcherPress("w", "a", true, 30_000);
  noteSwitcherPress("w", "b", true, 32_500);
  assert.equal(switcherSwitchProperties("w", "b", 32_510).switcher_corrected, false);
  noteSwitcherPress("w", "b", true, 33_000);
  assert.equal(switcherSwitchProperties("w", "b", 33_010).switcher_corrected, false);
  noteSwitcherPress("other", "c", true, 33_500);
  assert.equal(switcherSwitchProperties("other", "c", 33_510).switcher_corrected, false);
});

test("a press is matched to one switch only, and a stale press to none", () => {
  noteSwitcherPress("w", "d", true, 40_000);
  assert.equal(switcherSwitchProperties("w", "d", 40_100).via_switcher, true);
  assert.equal(switcherSwitchProperties("w", "d", 40_200).via_switcher, false);
  noteSwitcherPress("w", "e", true, 50_000);
  assert.equal(switcherSwitchProperties("w", "e", 54_000).via_switcher, false);
});

test("nothing is kept while sharing is off", () => {
  client.setSharing(false, "settings");
  noteSwitcherPress("w", "f", true, 60_000);
  assert.equal(switcherSwitchProperties("w", "f", 60_010).via_switcher, false);
});
