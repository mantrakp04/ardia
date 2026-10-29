import assert from "node:assert/strict";
import test from "node:test";
import { create } from "zustand";
import { watchInstallPromptCancellations } from "./extensionPrompts.ts";

function fixture() {
  const listeners = new Set();
  const invoked = [];
  const host = {
    bootstrap: { windowId: "main", profileId: "default", capabilities: [] },
    invoke: async (method, args) => { invoked.push([method, args]); return null; },
    call: async (name, profile, args) => { invoked.push([name, args]); return "null"; },
    onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const emit = (name, data) => { for (const listener of [...listeners]) listener("ArdiaExtensions", "extensions", { name, data }); };
  const store = create(() => ({ install: null }));
  return { host, emit, store, invoked, listeners };
}

const prompt = (requestId) => ({ windowId: "main", profile: "", source: "webStore", status: "ready", pkg: { id: "x" }, prompt: { requestId, id: "x", name: "X" } });

test("a prompt whose tab went away is dismissed without answering it again", () => {
  const f = fixture();
  watchInstallPromptCancellations(f.host, f.store);
  f.store.setState({ install: prompt("install7") });
  f.emit("extensions.installPromptCancelled", { requestId: "install7" });
  assert.equal(f.store.getState().install, null);
  assert.deepEqual(f.invoked, []);
});

test("a cancellation for another prompt, an unpacked install or junk leaves the dialog alone", () => {
  const f = fixture();
  const stop = watchInstallPromptCancellations(f.host, f.store);
  f.store.setState({ install: prompt("install8") });
  f.emit("extensions.installPromptCancelled", { requestId: "install7" });
  f.emit("extensions.installPromptCancelled", null);
  f.emit("extensions.changed", { requestId: "install8" });
  assert.equal(f.store.getState().install.prompt.requestId, "install8");
  const unpacked = { windowId: "main", profile: "", source: "unpacked", status: "ready", pkg: { id: "y" } };
  f.store.setState({ install: unpacked });
  f.emit("extensions.installPromptCancelled", { requestId: "install8" });
  assert.equal(f.store.getState().install, unpacked);
  stop();
  assert.equal(f.listeners.size, 0);
});
