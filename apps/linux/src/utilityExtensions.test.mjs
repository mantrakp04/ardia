import assert from "node:assert/strict";
import test from "node:test";
import { followExtensionChanges, settingsShowsExtensions } from "./utilityExtensions.ts";

function fixture(lists) {
  const listeners = new Set();
  const host = { onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const emit = (module, name, data) => { for (const listener of [...listeners]) listener(module, "extensions", { name, data }); };
  const refreshed = [];
  const stop = followExtensionChanges(host, (profile) => Object.hasOwn(lists, profile), (profile) => refreshed.push(profile));
  return { emit, refreshed, stop, listeners };
}

test("a Settings window refreshes the list of every profile it shows when that profile's extensions change", () => {
  const f = fixture({ default: [], "isolated-work": [] });
  f.emit("ArdiaExtensions", "extensions.changed", { profile: "isolated-work", id: "x", change: "installed" });
  f.emit("ArdiaExtensions", "extensions.changed", { profile: "default", id: "x", change: "uninstalled" });
  assert.deepEqual(f.refreshed, ["isolated-work", "default"]);
});

test("changes for a profile it never showed, other events and malformed payloads refresh nothing", () => {
  const f = fixture({ default: [] });
  f.emit("ArdiaExtensions", "extensions.changed", { profile: "elsewhere" });
  f.emit("ArdiaExtensions", "extensions.changed", { profile: "toString" });
  f.emit("ArdiaExtensions", "extensions.installPrompt", { profile: "default" });
  f.emit("ArdiaWebView", "extensions.changed", { profile: "default" });
  f.emit("ArdiaExtensions", "extensions.changed", null);
  f.emit("ArdiaExtensions", "extensions.changed", { profile: 7 });
  assert.deepEqual(f.refreshed, []);
  f.stop();
  assert.equal(f.listeners.size, 0);
});

test("a profile whose first extension listing failed in Settings still refreshes on its next change", async () => {
  const { load } = await import("../../browser/src/state/settings/resources.ts");
  const { extensionList } = await import("../../browser/src/state/settings/paneData.ts");
  const { useExtensions } = await import("./extensionsStore.ts");
  const warn = console.warn;
  console.warn = () => {};
  globalThis.acTestUserScripts = { engine: { list: async () => { throw new Error("engine busy"); } } };
  try {
    await load(extensionList, ["isolated-failed"]);
  } finally {
    delete globalThis.acTestUserScripts;
    console.warn = warn;
  }
  assert.equal(Object.hasOwn(useExtensions.getState().lists, "isolated-failed"), false);
  assert.equal(settingsShowsExtensions("isolated-failed"), true);
  assert.equal(settingsShowsExtensions("isolated-never-shown"), false);
  const listeners = new Set();
  const host = { onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const refreshed = [];
  const stop = followExtensionChanges(host, settingsShowsExtensions, (profile) => refreshed.push(profile));
  for (const listener of [...listeners]) listener("ArdiaExtensions", "extensions", { name: "extensions.changed", data: { profile: "isolated-failed" } });
  stop();
  assert.deepEqual(refreshed, ["isolated-failed"]);
});
