import assert from "node:assert/strict";
import { test } from "node:test";
const { sessionWithTabPages, sessionWithTabPins } = await import("./savedShapes.ts");
const { sessionWithSettingsMeta } = await import("../settings/settings.ts");
const { sessionWithPinChoiceStamps } = await import("../pins/pinChoices.ts");
const { Clock } = await import("@ardia/sync");

const replays = (step, doc) => {
  const once = step(structuredClone(doc));
  assert.deepEqual(step(structuredClone(once)), once, "a second run changes nothing");
  return once;
};

test("4 → 5 run twice keeps an asleep page and its pending restore", () => {
  const once = replays(sessionWithTabPages, { tabs: [{ id: "a", unloaded: true, wakeAdoptId: "restore:x" }, { id: "b", navigation: { url: "u", seq: 1 } }] });
  assert.deepEqual(once.tabs.map((t) => t.page), [{ kind: "asleep", wake: "restore:x" }, { kind: "idle" }]);
});

test("5 → 6 run twice keeps rows, tiles and folders, on open tabs and on parked and closed snapshots", () => {
  const folder = { id: "f", name: "Work" };
  const once = replays(sessionWithTabPins, {
    tabs: [{ id: "r", pinned: true, pinnedAsRow: true }, { id: "t", pinned: true, tileFolder: folder }, { id: "u", pinned: false }],
    closedTabs: [{ id: "c", tab: { url: "u", pinned: true, pinnedAsRow: true } }],
    closedWindows: [{ id: "w", tabs: [{ url: "u", pinned: true }] }],
    parkedPins: { default: { tabs: [{ id: "p", pinned: true, tileFolder: folder }], groups: [] } },
  });
  assert.deepEqual(once.tabs.map((t) => t.pin), [{ as: "row" }, { as: "tile", folder }, null]);
  assert.deepEqual(once.closedTabs[0].tab.pin, { as: "row" });
  assert.deepEqual(once.closedWindows[0].tabs[0].pin, { as: "tile" });
  assert.deepEqual(once.parkedPins.default.tabs[0].pin, { as: "tile", folder });
});

test("7 → 8 run twice keeps explicit choices chosen and inferred keys inferred", () => {
  const once = replays(sessionWithSettingsMeta, { settings: { tabLayout: "top", appearance: "dark", chosen: ["tabLayout"], inferred: ["appearance"] } });
  assert.deepEqual(once.settingsMeta, { chosen: ["tabLayout"], inferred: ["appearance"] });
  const legacy = replays(sessionWithSettingsMeta, { settings: { batterySaver: false, newTabPosition: "top" } });
  assert.ok(legacy.settingsMeta.chosen.includes("batterySaverWhen") && legacy.settingsMeta.inferred.includes("batterySaverWhen"));
});

test("8 → 9 run twice turns each pending pin choice's time into an HLC that orders the same way", () => {
  const once = replays(sessionWithPinChoiceStamps, { pinChoices: { default: { a: 1_000, b: 2_000, broken: { x: 1 } }, work: "nonsense" } });
  assert.deepEqual(once.pinChoices, { default: { a: new Clock("", null, () => 1_000).tick(), b: new Clock("", null, () => 2_000).tick() }, work: {} });
  assert.ok(once.pinChoices.default.a < once.pinChoices.default.b);
  assert.deepEqual(replays(sessionWithPinChoiceStamps, { tabs: [] }), { tabs: [] }, "a session without choices is left as it is");
});
