import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");
const { PRESETS } = await import("../onboarding/presets.ts");
const { SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { setSwitcherIcon } = await import("./actions.ts");

const S = () => useBrowser.getState();
const space = (id, name, icon) => ({ id, name, color: "plum", icon, createdAt: 0 });

test("the switcher shows dots by default and icons for Arc and Zen, and the choice syncs", () => {
  assert.equal(DEFAULT_SETTINGS.spaceSwitcherIcons, false);
  assert.ok(SYNCED_SETTINGS.includes("spaceSwitcherIcons"));
  for (const preset of ["arc", "zen"]) assert.equal(PRESETS[preset].spaceSwitcherIcons, true, preset);
  for (const preset of ["dia", "chrome", "safari", "firefox", "brave", "edge", "fresh"]) assert.equal(PRESETS[preset].spaceSwitcherIcons, false, preset);
});

test("picking an icon from the switcher turns icons on, and clearing one leaves the setting alone", () => {
  S().hydrate({ spaces: { work: space("work", "Work", null), home: space("home", "Home", null) }, spaceOrder: ["work", "home"] });
  S().updateSettings({ spaceSwitcherIcons: false });
  setSwitcherIcon("work", null);
  assert.equal(S().settings.spaceSwitcherIcons, false);
  setSwitcherIcon("work", "symbol:briefcase.fill");
  assert.equal(S().spaces.work.icon, "symbol:briefcase.fill");
  assert.equal(S().settings.spaceSwitcherIcons, true);
  setSwitcherIcon("work", null);
  assert.equal(S().spaces.work.icon, null);
  assert.equal(S().settings.spaceSwitcherIcons, true);
});
