import assert from "node:assert/strict";

const listeners = new Set();
const requests = [];
let reply = '{"entries":[]}';
globalThis.window = {
  __ardiaHost: {
    bootstrap: { windowId: "window", profileId: "default", launchConfig: { dataDirectory: "/scratch", background: true, isolated: true, testInstance: false, instance: {}, switches: { newTabPrewarm: false }, trace: [], test: {} } },
    call: async (...args) => { requests.push(args); return reply; },
    invoke: async () => { throw new Error("Obsolete invoke path"); },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  },
};
const { requireNativeModule } = await import("../src/shims/expo-modules-core.ts");
const config = requireNativeModule("ArdiaApp").launchConfig();
assert.equal(config.then, undefined);
assert.equal(config.switches.newTabPrewarm, false);
const { call, on } = await import("../../../packages/ardiacore/src/engine/call.ts");
assert.deepEqual(await call("history.query", { profile: "default", maxUrls: 4, maxVisits: 7 }), { entries: [] });
assert.deepEqual(requests.at(-1), ["history.query", "default", '{"maxUrls":4,"maxVisits":7}']);
reply = '"plain string"';
assert.equal(await call("engine.endTracing", { keep: true }), "plain string");
reply = "false";
assert.equal(await call("engine.isTracing"), false);
reply = "null";
assert.equal(await call("downloads.pause", { id: "download" }), null);
reply = '{"error":"refused"}';
await assert.rejects(call("downloads.resume", { id: "download" }), { name: "ArdiaError", code: "ERR_ENGINE", message: "refused" });
reply = "";
await assert.rejects(call("engine.isTracing"), { name: "ArdiaError", code: "ERR_BAD_REPLY" });
const received = [];
const subscription = on("history.changed", (data) => received.push(data));
for (const listener of listeners) listener("ArdiaHistory", "history", { name: "history.changed", data: { profile: "default" } });
assert.deepEqual(received, [{ profile: "default" }]);
subscription.remove();
for (const listener of listeners) listener("ArdiaHistory", "history", { name: "history.changed", data: {} });
assert.equal(received.length, 1);
console.log("production domain wrappers, bootstrap adapter, errors and events passed");
