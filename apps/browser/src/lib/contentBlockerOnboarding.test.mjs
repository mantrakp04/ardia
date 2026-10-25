import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

let state, calls, activate, confirm;
globalThis.onboardingBlockerNative = {
  read: () => Promise.resolve(state),
  select: (provider, consent) => activate(provider, consent),
  confirm: (options) => confirm(options),
};
const mock = "data:text/javascript," + encodeURIComponent(`
export const getContentBlocker = () => globalThis.onboardingBlockerNative.read();
export const setContentBlockerProvider = (provider, consent) => globalThis.onboardingBlockerNative.select(provider, consent);
export const onContentBlockerChange = () => ({ remove() {} });
`);
const shell = "data:text/javascript," + encodeURIComponent(`export const confirm = options => globalThis.onboardingBlockerNative.confirm(options);`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@ardia/shell") return { url: shell, shortCircuit: true };
    if (["./contentBlockerSelection", "./contentBlockerConsent"].includes(specifier)) specifier += ".ts";
    return specifier === "@ardia/ardiacore" ? { url: mock, shortCircuit: true } : next(specifier, context);
  },
});
const { applyOnboardingBlocker } = await import("./contentBlockerOnboarding.ts");
const active = () => true;

beforeEach(() => {
  calls = [];
  state = { provider: "ublock", selectedProvider: "ublock", clickAds: false, stats: { ready: true } };
  activate = async (provider, consent) => {
    calls.push(["provider", provider, consent]);
    state = { ...state, provider, selectedProvider: provider, clickAds: provider === "adnauseam" && consent };
  };
  confirm = async options => { calls.push(["confirm", options]); return { confirmed: true }; };
});

test("uBlock stays the default and does not ask for clicking consent", async () => {
  assert.equal(await applyOnboardingBlocker("ublock", active), true);
  assert.deepEqual(calls, [["provider", "ublock", false]]);
  assert.equal(state.clickAds, false);
});

test("AdNauseam confirmation explains clicking before one atomic activation", async () => {
  assert.equal(await applyOnboardingBlocker("adnauseam", active, "setup-window"), true);
  assert.equal(calls[0][0], "confirm");
  const options = calls[0][1];
  assert.equal(options.windowId, "setup-window");
  assert.equal(options.confirmTitle, "Enable Active Obfuscation");
  assert.match(options.message, /extra data/);
  assert.match(options.message, /Switch to Standard/);
  assert.deepEqual(calls[1], ["provider", "adnauseam", true]);
  assert.equal(state.clickAds, true);
});

test("cancelling consent keeps the existing blocker and setup step", async () => {
  confirm = async () => ({ confirmed: false });
  assert.equal(await applyOnboardingBlocker("adnauseam", active), false);
  assert.equal(state.provider, "ublock");
  assert.deepEqual(calls, []);
});

test("a dismissed setup never activates after a delayed confirmation", async () => {
  let current = true;
  confirm = async () => { current = false; return { confirmed: true }; };
  assert.equal(await applyOnboardingBlocker("adnauseam", () => current), false);
  assert.equal(state.clickAds, false);
  assert.deepEqual(calls, []);
});

test("a stale setup never shows a confirmation or changes the provider", async () => {
  assert.equal(await applyOnboardingBlocker("adnauseam", () => false), false);
  assert.deepEqual(calls, []);
});

test("failed activation is reported without advancing setup", async () => {
  activate = async () => { throw new Error("Activation failed"); };
  await assert.rejects(applyOnboardingBlocker("adnauseam", active), /Activation failed/);
  assert.equal(state.clickAds, false);
});

test("an already committed activation cannot advance a replacement setup", async () => {
  let current = true;
  activate = async () => { current = false; };
  assert.equal(await applyOnboardingBlocker("adnauseam", () => current), false);
});

test("replaying setup preserves consent without another confirmation", async () => {
  state = { ...state, provider: "adnauseam", selectedProvider: "adnauseam", clickAds: true };
  assert.equal(await applyOnboardingBlocker("adnauseam", active), true);
  assert.deepEqual(calls, [["provider", "adnauseam", true]]);
});

test("a legacy or failed AdNauseam choice with clicking off requires confirmation", async () => {
  state = { ...state, provider: "adnauseam", selectedProvider: "adnauseam", clickAds: false };
  confirm = async options => { calls.push(["confirm", options]); return { confirmed: false }; };
  assert.equal(await applyOnboardingBlocker("adnauseam", active), false);
  assert.deepEqual(calls.map(call => call[0]), ["confirm"]);
  assert.equal(state.clickAds, false);
});

test("returning to uBlock clears clicking consent without a confirmation", async () => {
  state = { ...state, provider: "adnauseam", selectedProvider: "adnauseam", clickAds: true };
  assert.equal(await applyOnboardingBlocker("ublock", active), true);
  assert.deepEqual(calls, [["provider", "ublock", false]]);
  assert.equal(state.clickAds, false);
});
