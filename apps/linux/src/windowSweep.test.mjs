import assert from "node:assert/strict";
import test from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../browser/src/state/browser/store.ts");
const { createWindowSync } = await import("../../browser/src/state/windows/windowSync.ts");
const { initialLinuxSession } = await import("./session.ts");
const { snapshotHostSession } = await import("./hostSession.ts");
const { createLinuxWindowIds } = await import("./windowSweep.ts");

const S = () => useBrowser.getState();

function nativeHost(windowId, live) {
  const calls = [];
  return {
    calls,
    bootstrap: { windowId, profileId: "default", startup: false },
    invoke: async (method, args) => {
      calls.push([method, args]);
      if (method === "ArdiaShell.windowIds") return [...live];
      return null;
    },
    call: async () => "null",
    onEvent: () => () => {},
  };
}

async function startSecondRenderer(windowId, saved, live) {
  S().hydrate(initialLinuxSession({ bootstrap: { windowId, profileId: "default", startup: false } }, saved));
  const host = nativeHost(windowId, live);
  const closed = [];
  const titled = [];
  const sync = createWindowSync({
    port: { open() {}, close: (id) => closed.push(id), setTitle: (id) => titled.push(id), windowIds: createLinuxWindowIds(host, S), restoreFullScreen() {}, onEvent() {}, releaseProfile() {} },
    getState: S, isQuitting: () => false, lightsCenter: () => null, isUtilityWindow: (id) => id === "settings" || id === "import",
  });
  sync.sync(S());
  await sync.sweep();
  return { closed, titled };
}

test("a window opened inside the session save delay survives a second renderer's startup sweep", async () => {
  S().hydrate(initialLinuxSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  const saved = snapshotHostSession(S());
  const fresh = S().createWindow();
  const { closed, titled } = await startSecondRenderer("window-3", saved, ["main", fresh, "window-3", "settings"]);
  assert.deepEqual(closed, []);
  assert.ok(titled.includes("main"));
  assert.ok(titled.includes("window-3"));
  assert.ok(!titled.includes(fresh));
});

test("a Little Ardia window the session never saves survives a reloaded renderer's sweep", async () => {
  S().hydrate(initialLinuxSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  const small = S().createWindow({ kind: "small", url: "https://example.com/" });
  const saved = snapshotHostSession(S());
  assert.equal(saved.windows?.[small], undefined);
  const { closed } = await startSecondRenderer("main", saved, ["main", small]);
  assert.deepEqual(closed, []);
});

test("a private renderer's sweep leaves regular windows alone", async () => {
  S().hydrate(initialLinuxSession({ bootstrap: { windowId: "main", profileId: "default", startup: false } }, null));
  const saved = snapshotHostSession(S());
  const regular = S().createWindow();
  const { closed } = await startSecondRenderer("private-1", saved, ["main", regular, "private-1"]);
  assert.deepEqual(closed, []);
});
