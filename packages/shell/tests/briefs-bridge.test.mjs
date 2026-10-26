import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "expo-modules-core") return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent("export const requireOptionalNativeModule = () => globalThis.briefsModule ?? null;")}`, shortCircuit: true };
  },
});
const bridge = await import("../src/briefs.ts");

test("missing native module rejects every asynchronous brief bridge call", async () => {
  globalThis.briefsModule = null;
  for (const [name, args] of [
    ["cancelChatGPTSignIn", []], ["briefProviderStatus", []], ["disconnectChatGPT", []],
    ["generateDailyBrief", ["{}"]], ["cancelDailyBriefGeneration", []], ["connectChatGPT", [() => {}]],
  ]) {
    let promise;
    assert.doesNotThrow(() => { promise = bridge[name](...args); });
    await assert.rejects(promise, /build needs an update/);
  }
});

test("bridge forwards asynchronous generation and cancellation failures", async () => {
  const failure = new Error("cancel failed");
  globalThis.briefsModule = { generateDailyBrief: async (context) => context, cancelDailyBriefGeneration: () => { throw failure; } };
  assert.equal(await bridge.generateDailyBrief("context"), "context");
  await assert.rejects(bridge.cancelDailyBriefGeneration(), (error) => error === failure);
});
