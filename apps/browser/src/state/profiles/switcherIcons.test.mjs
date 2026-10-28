import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");
const { PRESETS } = await import("../onboarding/presets.ts");
const { SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { setSwitcherIcon } = await import("./actions.ts");

const S = () => useBrowser.getState();
const profile = (id, name, icon) => ({ id, name, color: "plum", icon, createdAt: 0 });

test("the switcher shows dots by default and icons for Arc and Zen, and the choice syncs", () => {
  assert.equal(DEFAULT_SETTINGS.profileSwitcherIcons, false);
  assert.ok(SYNCED_SETTINGS.includes("profileSwitcherIcons"));
  for (const preset of ["arc", "zen"]) assert.equal(PRESETS[preset].profileSwitcherIcons, true, preset);
  for (const preset of ["dia", "chrome", "safari", "firefox", "brave", "edge", "fresh"]) assert.equal(PRESETS[preset].profileSwitcherIcons, false, preset);
});

test("picking an icon from the switcher turns icons on, and clearing one leaves the setting alone", () => {
  S().hydrate({ profiles: { work: profile("work", "Work", null), home: profile("home", "Home", null) }, profileOrder: ["work", "home"] });
  S().updateSettings({ profileSwitcherIcons: false });
  setSwitcherIcon("work", null);
  assert.equal(S().settings.profileSwitcherIcons, false);
  setSwitcherIcon("work", "symbol:briefcase.fill");
  assert.equal(S().profiles.work.icon, "symbol:briefcase.fill");
  assert.equal(S().settings.profileSwitcherIcons, true);
  setSwitcherIcon("work", null);
  assert.equal(S().profiles.work.icon, null);
  assert.equal(S().settings.profileSwitcherIcons, true);
});
