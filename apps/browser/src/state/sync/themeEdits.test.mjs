import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;

const folder = new Map();
let heldScope = null;
let releaseRead = null;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => "devC",
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      if (scope === heldScope) {
        heldScope = null;
        await new Promise((resolve) => (releaseRead = resolve));
      }
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: [], damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { setProfileTheme } = await import("../profiles/themeActions.ts");
const quit = await import("../app/quit.ts");
const S = () => useBrowser.getState();
const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
};
const until = async (done) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(done());
};

const look = (intensity) => ({ stops: [{ x: 0.5, y: 0.5, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }], intensity, mode: "auto", grain: 0.2, texture: "grain", translucency: 1 });
const THEME_A = look(0.3);
const THEME_B = look(0.6);
const THEME_C = look(0.9);
const justAfter = (h) => `${h.slice(0, 9)}.${(parseInt(h.slice(10, 14), 36) + 1).toString(36).padStart(4, "0")}.devZ`;
const remoteTheme = (key, h, theme) => folder.set("remote", { scope: "app", payload: JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 1, at: Date.now(), ops: [{ k: key, h, v: { t: theme } }] }) });
const opsFor = (key) =>
  [...folder.values()].flatMap(({ payload }) => {
    const file = JSON.parse(payload);
    return (file.ops ?? []).filter((op) => op.k === key).map((op) => ({ ...op, device: file.device }));
  });

test("known issue, expected for now: a theme picked while a pull reads is replaced by the newer theme that pull brings", async () => {
  shell.docs.clear();
  S().hydrate({});
  useBrowser.setState({ bookmarksReady: { "": true } });
  S().setProfileLook("default", { theme: THEME_A });
  const engine = await import("./engine.ts?editDuringRead");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  await engine.syncNow();
  await engine.syncNow();
  const key = `pth:${engine.useSync.getState().profiles.default.syncId}`;
  assert.deepEqual(opsFor(key).at(-1)?.v, { t: THEME_A });

  remoteTheme(key, justAfter(opsFor(key).at(-1).h), THEME_B);
  heldScope = "app";
  releaseRead = null;
  const cycle = engine.syncNow();
  await until(() => releaseRead);
  clockOffset += 1_000;
  setProfileTheme("default", THEME_C, engine.adoptProfileTheme);
  releaseRead();
  await cycle;
  assert.deepEqual(S().profiles.default.theme, THEME_B, "documented in ~/ardia-scratch/slop-audit/sync-known-issues.md: the pick is overwritten until picks get durable stamps");
});

test("a profile's own theme that was never picked still gives way to a theme that arrives in a pull", async () => {
  shell.docs.clear();
  folder.clear();
  S().hydrate({});
  useBrowser.setState({ bookmarksReady: { "": true } });
  S().setProfileLook("default", { theme: THEME_A });
  const engine = await import("./engine.ts?fallback");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  await engine.syncNow();
  await engine.syncNow();
  const key = `pth:${engine.useSync.getState().profiles.default.syncId}`;
  remoteTheme(key, justAfter(opsFor(key).at(-1).h), THEME_B);
  quit.setQuitting(true);
  try {
    await engine.syncNow();
  } finally {
    quit.setQuitting(false);
  }
  assert.deepEqual(S().profiles.default.theme, THEME_A, "the theme arrived but waits");
  S().setProfileLook("default", { theme: THEME_C });
  await engine.syncNow();
  await engine.syncNow();
  assert.deepEqual(S().profiles.default.theme, THEME_B, "a look set without a pick doesn't publish over the arrived theme");
});
