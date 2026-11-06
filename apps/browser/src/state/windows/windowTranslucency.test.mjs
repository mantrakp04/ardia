import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";
import { useBrowser } from "../browser/store.ts";
import { WindowContext } from "../browser/hooks.ts";
import { useScopedLook } from "../app/theme.ts";
import { scopedTheme, profileTheme } from "../../components/ui/theme.ts";
import { DEFAULT_SETTINGS, parseSettings, SETTING_SPECS } from "../settings/settings.ts";
import { SYNCED_SETTINGS } from "../sync/settingsAdapter.ts";
import { isConfigSettingKey } from "../settings/configAllowlist.ts";
import { provideProfileLooks } from "../profiles/looks.ts";
import { launchBackdrop } from "./launchBackdrop.ts";
import { flushPersistence, loadSession, startPersistence } from "../session/persist.ts";
import { docs } from "../../test-native/index.ts";
import { search } from "../../components/settings/searchMatch.ts";
import { SETTINGS_INDEX } from "../../components/settings/settingsIndex.ts";

const S = () => useBrowser.getState();
const preset = { color: "plum" };
const custom = {
  color: "blue",
  theme: {
    stops: [{ x: 0.5, y: 0.5, color: { r: 0.2, g: 0.4, b: 0.8, a: 0.4 } }],
    intensity: 0.5, grain: 0.3, texture: "grain", mode: "auto", translucency: 0.6,
  },
};

test("window translucency defaults on, persists false, and stays device-local", () => {
  assert.equal(DEFAULT_SETTINGS.windowTranslucency, true);
  assert.equal(parseSettings({ windowTranslucency: false }).windowTranslucency, false);
  assert.equal(parseSettings({ windowTranslucency: "off" }).windowTranslucency, true);
  assert.equal(SETTING_SPECS.windowTranslucency.synced, false);
  assert.ok(!SYNCED_SETTINGS.includes("windowTranslucency"));
  assert.ok(isConfigSettingKey("windowTranslucency"));
  assert.equal(search(SETTINGS_INDEX, "opaque")[0].entry.id, "appearance.windowTranslucency");
});

test("disabling window translucency preserves cached preset and custom colours and blur amounts", () => {
  const original = JSON.stringify(custom);
  for (const dark of [false, true]) {
    for (const profile of [preset, custom, { ...custom, theme: { ...custom.theme, translucency: 0 } }]) {
      const normal = scopedTheme(false, profile, dark, "own");
      const opaque = scopedTheme(false, profile, dark, "own", null, false);
      assert.equal(opaque.backdrop.backgroundBlurEnabled, false);
      assert.deepEqual(opaque, { ...normal, backdrop: { ...normal.backdrop, backgroundBlurEnabled: false } });
      assert.equal(scopedTheme(false, profile, dark, "own", null, false), opaque);
      assert.equal(scopedTheme(false, profile, dark, "own", null, true), normal);
      assert.equal(normal.backdrop.backgroundBlurEnabled, profile.theme ? profile.theme.translucency > 0 : true);
    }
  }
  assert.equal(JSON.stringify(custom), original);
});

test("restoring translucency respects the independently resolved light and dark custom looks", () => {
  const profile = { ...custom, theme: { ...custom.theme, translucency: 0, dark: { ...custom.theme, translucency: 1 } } };
  for (const dark of [false, true]) {
    assert.equal(scopedTheme(false, profile, dark, "own", null, false).backdrop.backgroundBlurEnabled, false);
    assert.equal(scopedTheme(false, profile, dark, "own", null, true).backdrop.backgroundBlurEnabled, dark);
  }
});

test("open regular, private and little windows react to the global setting without changing their theme colours", () => {
  S().hydrate({ settings: {} });
  const windows = [S().createWindow({}), S().createWindow({ kind: "private" }), S().createWindow({ kind: "small" })];
  const views = windows.map((window) => mount(() => useScopedLook(scopedTheme), { contexts: [[WindowContext, window]] }));
  try {
    const before = views.map((view) => view.value);
    assert.ok(before.every((theme) => theme.backdrop.backgroundBlurEnabled));
    assert.equal(before[1].dark, true);
    S().updateSettings({ windowTranslucency: false });
    views.forEach((view, index) => {
      assert.equal(view.value.backdrop.backgroundBlurEnabled, false);
      assert.deepEqual(view.value.windowTint, before[index].windowTint);
      assert.equal(view.value.dark, before[index].dark);
    });
    S().updateSettings({ windowTranslucency: true });
    views.forEach((view, index) => assert.equal(view.value, before[index]));
  } finally {
    views.forEach((view) => view.unmount());
  }
});

test("the saved startup backdrop follows the global override and the selected custom look", () => {
  provideProfileLooks({ accent: () => "", theme: profileTheme });
  S().hydrate({ settings: {} });
  const window = S().createWindow({});
  const profileId = S().windows[window].profileId;
  for (const profile of [preset, custom, { ...custom, theme: { ...custom.theme, translucency: 0 } }]) {
    S().setProfileLook(profileId, { color: profile.color, theme: profile.theme ?? null });
    S().updateSettings({ windowTranslucency: true });
    const normal = launchBackdrop(S(), window);
    assert.equal(normal.backgroundBlurEnabled, profile.theme ? profile.theme.translucency > 0 : true);
    S().updateSettings({ windowTranslucency: false });
    assert.deepEqual(launchBackdrop(S(), window), { ...normal, backgroundBlurEnabled: false });
  }
});

test("changing translucency saves both the preference and early startup material for the next launch", () => {
  docs.clear();
  provideProfileLooks({ accent: () => "", theme: profileTheme });
  const stop = startPersistence();
  try {
    const window = S().createWindow({ url: "https://example.com/" });
    S().setFocusedWindow(window);
    for (const enabled of [false, true, false]) {
      S().updateSettings({ windowTranslucency: enabled });
      flushPersistence();
      const saved = JSON.parse(docs.get("session.json"));
      assert.equal(saved.settings.windowTranslucency, enabled);
      assert.equal(saved.launchBackdrop.backgroundBlurEnabled, enabled);
    }
  } finally {
    stop();
  }
  S().hydrate(loadSession());
  assert.equal(S().settings.windowTranslucency, false);
});
