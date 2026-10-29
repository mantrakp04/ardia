import assert from "node:assert/strict";
import { test } from "node:test";
const { cleanUpChoices, CUSTOM_CLEAN_UP, minutesFromHours, settingsWithCleanUpMinutes } = await import("./cleanUpAfter.ts");
const { useBrowser } = await import("../browser/store.ts");
const { loadSession } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const titles = (minutes) => cleanUpChoices(minutes).map((c) => c.title);

test("Custom… sits right below 12 hours, and a custom time shows among the presets by length", () => {
  assert.deepEqual(titles(1440), ["12 hours", "Custom…", "24 hours", "7 days", "30 days"]);
  assert.deepEqual(titles(45), ["45 minutes", "12 hours", "Custom…", "24 hours", "7 days", "30 days"]);
  assert.deepEqual(titles(18 * 60), ["12 hours", "Custom…", "18 hours", "24 hours", "7 days", "30 days"]);
  assert.deepEqual(titles(2 * 1440), ["12 hours", "Custom…", "24 hours", "2 days", "7 days", "30 days"]);
  assert.deepEqual(titles(90 * 1440), ["12 hours", "Custom…", "24 hours", "7 days", "30 days", "90 days"]);
  const choices = cleanUpChoices(45);
  assert.equal(choices.find((c) => c.title === "45 minutes").value, "45");
  assert.equal(choices.find((c) => c.title === "Custom…").value, CUSTOM_CLEAN_UP);
});

test("hours saved by older builds become exact minutes; Never stays Never, nonsense goes", () => {
  assert.equal(minutesFromHours(12), 720);
  assert.equal(minutesFromHours(0.75), 45);
  assert.equal(minutesFromHours(null), null);
  for (const bad of [0, -1, "12", Number.NaN, undefined]) assert.equal(minutesFromHours(bad), undefined);
  assert.deepEqual(
    settingsWithCleanUpMinutes({ cleanUpInactiveTabsAfterHours: 168, tabLayout: "top", chosen: ["tabLayout", "cleanUpInactiveTabsAfterHours"], inferred: ["cleanUpInactiveTabsAfterHours"] }),
    { tabLayout: "top", cleanUpInactiveTabsAfterMinutes: 10080, chosen: ["tabLayout", "cleanUpInactiveTabsAfterMinutes"], inferred: ["cleanUpInactiveTabsAfterMinutes"] },
  );
  assert.deepEqual(settingsWithCleanUpMinutes({ cleanUpInactiveTabsAfterHours: "soon" }), {});
  const untouched = { tabLayout: "top" };
  assert.equal(settingsWithCleanUpMinutes(untouched), untouched);
});

test("a session saved with the hours setting relaunches with the same clean-up time in minutes", () => {
  stub.docs.clear();
  const session = (settings) =>
    JSON.stringify({ version: 2, profiles: {}, profileOrder: [], settings, windows: [], windowOrder: [], focusedWindowId: null, tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [] });
  stub.docs.set("session.json", session({ cleanUpInactiveTabsAfterHours: 24, chosen: ["cleanUpInactiveTabsAfterHours"] }));
  S().hydrate(loadSession());
  assert.equal(S().settings.cleanUpInactiveTabsAfterMinutes, 1440);
  assert.ok(S().settingsMeta.chosen.includes("cleanUpInactiveTabsAfterMinutes"));
  assert.ok(!("cleanUpInactiveTabsAfterHours" in S().settings));
  stub.docs.set("session.json", session({ cleanUpInactiveTabsAfterHours: null, chosen: ["cleanUpInactiveTabsAfterHours"] }));
  S().hydrate(loadSession());
  assert.equal(S().settings.cleanUpInactiveTabsAfterMinutes, null);
  stub.docs.clear();
});
