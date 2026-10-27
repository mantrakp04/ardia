import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");

const S = () => useBrowser.getState();

test("the profile dots setting is on by default and stays off once switched off", () => {
  S().hydrate({});
  assert.equal(S().settings.showProfileDots, true);
  S().updateSettings({ showProfileDots: false });
  assert.equal(S().settings.showProfileDots, false);
  S().updateSettings({ appearance: "dark" });
  assert.equal(S().settings.showProfileDots, false);
});
