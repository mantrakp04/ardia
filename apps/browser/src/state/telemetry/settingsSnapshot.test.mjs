import assert from "node:assert/strict";
import { test } from "node:test";

const { settingsSnapshot } = await import("./settingsSnapshot.ts");
const { cleanProperties } = await import("./sanitize.ts");
const { DEFAULT_SETTINGS, SETTING_SPECS } = await import("../settings/settings.ts");

test("on/off, pick-one and number settings are measured with their defaults; text and lists never are", () => {
  const snap = settingsSnapshot({ ...DEFAULT_SETTINGS, glassTintWithTheme: true, glassTintAmount: 0.55, interfaceStyle: "classic", customSearchUrl: "https://secret.example/?q=%s" });
  assert.equal(snap.setting_glassTintWithTheme, "true");
  assert.equal(snap.default_glassTintWithTheme, "false");
  assert.equal(snap.setting_glassTintAmount, "0.55");
  assert.equal(snap.default_glassTintAmount, "0.8");
  assert.equal(snap.setting_interfaceStyle, "classic");
  assert.equal(snap.default_interfaceStyle, "glass");
  for (const key of ["customSearchUrl", "searchEngine", "defaultProfileId", "customSearchEngines", "extensionSearchEngines"]) {
    assert.equal(snap[`setting_${key}`], undefined, key);
    assert.equal(snap[`default_${key}`], undefined, key);
  }
  assert.ok(!Object.values(snap).some((v) => v.includes("secret")));
});

test("every measured key survives the telemetry property cleaner unchanged", () => {
  const snap = settingsSnapshot(DEFAULT_SETTINGS);
  assert.deepEqual(cleanProperties(snap), snap);
  const measured = Object.keys(snap).filter((k) => k.startsWith("setting_")).length;
  assert.ok(measured > 30, `only ${measured} settings measured`);
  assert.ok(measured < Object.keys(SETTING_SPECS).length);
});

test("a value the spec doesn't allow is left out rather than sent", () => {
  const snap = settingsSnapshot({ ...DEFAULT_SETTINGS, interfaceStyle: "https://not-an-option.example" });
  assert.equal(snap.setting_interfaceStyle, undefined);
});
