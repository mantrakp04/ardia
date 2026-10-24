import assert from "node:assert/strict";
import { test } from "node:test";

const { providerStatusText, switchOnContinueText } = await import("./contentBlockerProvider.ts");

const state = (patch = {}) => ({
  provider: "ublock",
  selectedProvider: "ublock",
  availableProviders: ["ublock", "adnauseam"],
  clickAds: false,
  enabled: true,
  version: "1.65.0",
  lists: [],
  allowedHosts: [],
  stats: { ready: true, enabled: true, parseMs: 0, lookups: 0, averageLookupMicros: 0, maxLookupMicros: 0 },
  ...patch,
});

test("names the running blocker and reports an activation mismatch without suggesting a restart", () => {
  assert.equal(providerStatusText(state()), "uBlock Origin 1.65.0 is running.");
  assert.equal(
    providerStatusText(state({ selectedProvider: "adnauseam" })),
    "uBlock Origin 1.65.0 is running. AdNauseam could not be activated. Select it again to retry.",
  );
});

test("doesn't call a blocker running while it's off, starting or failed", () => {
  assert.equal(providerStatusText(state({ enabled: false })), "uBlock Origin 1.65.0 is loaded, with blocking off.");
  assert.equal(providerStatusText(state({ stats: { ...state().stats, ready: false } })), "uBlock Origin 1.65.0 is starting.");
  assert.equal(providerStatusText(state({ stats: { ...state().stats, ready: false, error: "unavailable" } })), "uBlock Origin 1.65.0 didn't start.");
});

test("onboarding describes activation on Continue", () => {
  assert.equal(switchOnContinueText("adnauseam"), "AdNauseam activates when you continue. No restart needed.");
  assert.equal(
    providerStatusText(state({ selectedProvider: "adnauseam" }), "Continue to retry."),
    "uBlock Origin 1.65.0 is running. AdNauseam could not be activated. Continue to retry.",
  );
});
