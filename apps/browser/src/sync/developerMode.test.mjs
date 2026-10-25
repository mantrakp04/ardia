import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const { developerModeAdapter } = await import("./adapters.ts");

const S = () => useBrowser.getState();

function folder() {
  const files = new Map();
  let n = 0;
  return {
    write: async (scope, payload) => {
      const id = `f${++n}`;
      files.set(id, { scope, payload });
      return id;
    },
    read: async (scope, known) => {
      const shown = [...files].filter(([, f]) => f.scope === scope);
      return { files: shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload })), pending: [], damaged: [], present: shown.map(([id]) => id) };
    },
    remove: async (_scope, ids) => ids.forEach((id) => files.delete(id)),
  };
}

function device(id, transport) {
  S().hydrate({});
  let browser = S();
  const state = emptyScope();
  const clock = new Clock(id);
  return {
    with(fn) {
      useBrowser.setState(browser, true);
      try {
        return fn();
      } finally {
        browser = S();
      }
    },
    async sync() {
      useBrowser.setState(browser, true);
      try {
        await syncScope({ scope: "p", state, transport, adapters: [developerModeAdapter("default")], clock, device: id });
      } finally {
        browser = S();
      }
    },
  };
}

const mode = (d) => d.with(() => S().settings.developerMode?.default);
const set = (d, value) => d.with(() => S().updateSettings({ developerMode: { default: value } }));

test("a profile's Developer Mode hosts, switched-off default hosts and reload choice reach the other Mac, and removals do too", async () => {
  const transport = folder();
  const a = device("a", transport);
  const b = device("b", transport);
  for (const d of [a, b, a, b]) await d.sync();
  set(a, { on: ["example.com"], off: ["localhost"], reload: "forceReload" });
  for (const d of [a, b]) await d.sync();
  assert.deepEqual(mode(b), { on: ["example.com"], off: ["localhost"], reload: "forceReload" });
  set(b, { on: [], off: ["localhost"], reload: "reload" });
  for (const d of [b, a]) await d.sync();
  assert.deepEqual(mode(a), { on: [], off: ["localhost"], reload: "reload" });
});
