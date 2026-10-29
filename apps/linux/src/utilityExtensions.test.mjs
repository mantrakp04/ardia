import assert from "node:assert/strict";
import test from "node:test";
import { followExtensionChanges } from "./utilityExtensions.ts";

function fixture(lists) {
  const listeners = new Set();
  const host = { onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const emit = (module, name, data) => { for (const listener of [...listeners]) listener(module, "extensions", { name, data }); };
  const refreshed = [];
  const stop = followExtensionChanges(host, () => lists, (profile) => refreshed.push(profile));
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
