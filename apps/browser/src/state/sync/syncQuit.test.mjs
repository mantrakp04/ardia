import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
let heldScope = null;
let releaseRead = null;
let heldSeal = null;
let releaseSeal = null;
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
    sealLocal: async (text) => {
      if (heldSeal && text.startsWith(heldSeal)) {
        heldSeal = null;
        await new Promise((resolve) => (releaseSeal = resolve));
      }
      return `sealed:${text}`;
    },
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { canonical } = await import("@ardia/sync");
const quit = await import("../app/quit.ts");
const S = () => useBrowser.getState();
const realNow = Date.now;
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
const stampAt = (wall) => `${Math.floor(wall).toString(36).padStart(9, "0")}.0000.devZ`;
const opsFor = (key) =>
  [...folder.values()].flatMap(({ payload }) => {
    const file = JSON.parse(payload);
    return (file.ops ?? []).filter((op) => op.k === key).map((op) => ({ ...op, device: file.device }));
  });

test("a theme pulled while quitting isn't applied after the session froze, so the saved state can't run ahead of it", async () => {
  shell.docs.clear();
  S().hydrate({});
  useBrowser.setState({ bookmarksReady: { "": true } });
  S().setProfileLook("default", { theme: THEME_A });
  const engine = await import("./engine.ts?quitting");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  await engine.syncNow();
  await engine.syncNow();
  const key = `pth:${engine.useSync.getState().profiles.default.syncId}`;
  assert.deepEqual(opsFor(key).at(-1)?.v, { t: THEME_A });

  heldSeal = '{"covers"';
  Date.now = () => realNow() + 60 * 60_000 + 1;
  try {
    await engine.syncNow();
    await until(() => releaseSeal);

    folder.set("remote", { scope: "app", payload: JSON.stringify({ v: 1, kind: "log", device: "devZ", seq: 1, at: Date.now(), ops: [{ k: key, h: stampAt(Date.now() + 60_000), v: { t: THEME_B } }] }) });
    heldScope = "app";
    const cycle = engine.syncNow();
    await until(() => releaseRead);

    quit.setQuitting(true);
    const frozen = S().profiles.default.theme;
    const quitting = quit.finishQuitSaves(5_000);
    releaseRead();
    await settle();
    releaseSeal();
    await cycle;
    await quitting;
    await settle();

    assert.deepEqual(S().profiles.default.theme, frozen, "nothing is applied after the session froze");
    const saved = JSON.parse(shell.docs.get("sync-state.nns").slice(7)).scopes.app;
    assert.equal(saved.base[key], canonical({ t: THEME_A }), "the saved base still matches the frozen session");
    assert.ok(saved.unapplied.includes(key), "and the pulled theme waits to be applied");
  } finally {
    Date.now = realNow;
    quit.setQuitting(false);
  }

  S().setProfileLook("default", { theme: THEME_A });
  const relaunched = await import("./engine.ts?relaunched");
  relaunched.startSync();
  await settle();
  await relaunched.syncNow();
  await relaunched.syncNow();
  assert.deepEqual(S().profiles.default.theme, THEME_B, "after the relaunch the pulled theme applies");
  assert.ok(!opsFor(key).some((op) => op.device === "devC" && op.v?.t?.intensity === THEME_A.intensity && op.h > stampAt(realNow())), "and the old theme is never published over it");
});
