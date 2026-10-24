import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.blockerSelectionNative = { listeners: new Set(), select: async () => {}, confirm: async () => ({ confirmed: true }) };
const shell = "data:text/javascript," + encodeURIComponent(`export const confirm = () => globalThis.blockerSelectionNative.confirm();`);
const mock = "data:text/javascript," + encodeURIComponent(`
export const getContentBlocker = async () => ({provider: 'ublock', selectedProvider: 'ublock', clickAds: false, stats: {ready: true}});
export const setContentBlockerProvider = (provider, consent) => globalThis.blockerSelectionNative.select(provider, consent);
export const onContentBlockerChange = (listener) => {
  globalThis.blockerSelectionNative.listeners.add(listener);
  return { remove() { globalThis.blockerSelectionNative.listeners.delete(listener); } };
};
`);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@ardia/shell") return {url: shell, shortCircuit: true};
    if (specifier === "./contentBlockerConsent") specifier += ".ts";
    return specifier === "@ardia/ardiacore" ? { url: mock, shortCircuit: true } : next(specifier, context);
  },
});
const { getActivatingBlocker, onBlockerSettingsChange, selectContentBlocker } = await import("./contentBlockerSelection.ts");

test("other screens see activation progress and overlapping switches are rejected", async () => {
  let complete;
  const seen = [];
  globalThis.blockerSelectionNative.select = (provider) => new Promise(resolve => {
    seen.push(provider);
    complete = resolve;
  });
  const subscription = onBlockerSettingsChange(() => seen.push(getActivatingBlocker() ? "activating" : "refresh"));
  try {
    const saving = selectContentBlocker("adnauseam");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ["activating", "adnauseam"]);
    assert.equal(getActivatingBlocker(), "adnauseam");
    await assert.rejects(selectContentBlocker("ublock"), /Another content blocker/);
    assert.equal(getActivatingBlocker(), "adnauseam");
    for (const listener of globalThis.blockerSelectionNative.listeners) listener();
    assert.deepEqual(seen, ["activating", "adnauseam"]);
    complete();
    await saving;
    assert.deepEqual(seen, ["activating", "adnauseam", "refresh"]);
    assert.equal(getActivatingBlocker(), null);
  } finally { subscription.remove(); }
});

test("an activation failure clears progress, refreshes screens and preserves the native error", async () => {
  const failure = new Error("The previous blocker is active again");
  let refreshed = 0;
  globalThis.blockerSelectionNative.select = async () => { throw failure; };
  const subscription = onBlockerSettingsChange(() => refreshed++);
  try {
    await assert.rejects(selectContentBlocker("ublock"), error => error === failure);
    assert.equal(refreshed, 2);
    assert.equal(getActivatingBlocker(), null);
  } finally { subscription.remove(); }
});

test("unmounting removes both native and selection notifications", async () => {
  let refreshed = 0;
  globalThis.blockerSelectionNative.select = async () => {};
  const subscription = onBlockerSettingsChange(() => refreshed++);
  for (const listener of globalThis.blockerSelectionNative.listeners) listener();
  assert.equal(refreshed, 1);
  subscription.remove();
  assert.equal(globalThis.blockerSelectionNative.listeners.size, 0);
  await selectContentBlocker("adnauseam");
  assert.equal(refreshed, 1);
});

for (const confirmed of [false, true]) {
  test(`pending consent does not announce activation before ${confirmed ? "confirmation" : "cancellation"}`, async () => {
    let answer;
    const seen = [];
    globalThis.blockerSelectionNative.confirm = () => new Promise(resolve => { answer = resolve; });
    globalThis.blockerSelectionNative.select = async provider => { seen.push(provider); };
    const subscription = onBlockerSettingsChange(() => seen.push(getActivatingBlocker() ? "activating" : "refresh"));
    const selection = selectContentBlocker("adnauseam");
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(getActivatingBlocker(), null);
      assert.deepEqual(seen, []);
      await assert.rejects(selectContentBlocker("ublock"), /Another content blocker/);
      answer({ confirmed });
      assert.equal(await selection, confirmed);
      assert.deepEqual(seen, confirmed ? ["activating", "adnauseam", "refresh"] : []);
      assert.equal(getActivatingBlocker(), null);
      seen.length = 0;
      assert.equal(await selectContentBlocker("ublock"), true);
      assert.deepEqual(seen, ["activating", "ublock", "refresh"]);
    } finally {
      answer?.({ confirmed: false });
      await selection.catch(() => {});
      subscription.remove();
      globalThis.blockerSelectionNative.confirm = async () => ({ confirmed: true });
    }
  });
}
