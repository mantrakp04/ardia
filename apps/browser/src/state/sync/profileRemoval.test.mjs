import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
const downloading = new Set();
const unreadable = new Set();
let ids = 0;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `id${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    enterPhrase: async () => ({ ok: true }),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const unknown = here.map(([id]) => id).filter((id) => !known.includes(id));
      const files = here.filter(([id]) => unknown.includes(id) && !downloading.has(id) && !unreadable.has(id)).map(([id, f]) => ({ id, payload: f.payload }));
      const damaged = unknown.filter((id) => unreadable.has(id) && !downloading.has(id)).map((id) => ({ id, age: 0 }));
      return { files, pending: unknown.filter((id) => downloading.has(id)), damaged, present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { sharingProfiles } = await import("../profiles/profiles.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { "": true } });
    this.browser = S();
    this.docs = new Map();
  }
  async with(fn) {
    useBrowser.setState(this.browser, true);
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    try {
      return await fn();
    } finally {
      this.browser = S();
      this.docs = new Map(shell.docs);
    }
  }
}

const published = (prefix) =>
  [...folder.values()]
    .map((f) => JSON.parse(f.payload))
    .flatMap((f) => f.ops ?? Object.entries(f.records ?? {}).map(([k, r]) => ({ k, v: r.v })))
    .filter((op) => op.k.startsWith(prefix));
async function turnOn(mac, engine) {
  await mac.with(async () => {
    engine.startSync();
    assert.ok("ok" in (await engine.turnOnSync("/sync")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

async function join(mac, engine, before = () => {}) {
  await mac.with(async () => {
    before();
    engine.startSync();
    assert.ok("ok" in (await engine.enterRecoveryPhrase("/sync", "words")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

const named = (name) => S().profileOrder.find((id) => S().profiles[id].name === name);


const live = (prefix, syncId) => {
  const last = published(`${prefix}${syncId}`).at(-1);
  return !!last && last.v !== null;
};

test("a profile deleted on the only Mac can be removed from sync: its records go, and no Mac is offered it again (#1197, #1175)", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?removeA");
  const engineC = await import("./engine.ts?removeC");
  const work = await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  const syncId = await a.with(async () => {
    S().deleteProfile(work);
    await engineA.syncNow();
    await engineA.syncNow();
    const offered = engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work");
    assert.ok(offered, "a deleted profile is still offered, so it can be added back");
    assert.equal(engineA.removeRemoteProfile(offered.syncId), true);
    assert.equal(engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work"), undefined, "it leaves the list at once");
    await engineA.syncNow();
    await engineA.syncNow();
    assert.equal(engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work"), undefined, "and stays gone after syncing");
    assert.equal(engineA.removeRemoteProfile(offered.syncId), false, "nothing left to remove");
    return offered.syncId;
  });
  for (const prefix of ["prof:", "share:", "pth:", "pta:"]) assert.equal(live(prefix, syncId), false, `${prefix} has no live record left`);
  await join(c, engineC);
  await c.with(() => assert.equal(engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Work"), undefined, "a Mac that joins later isn't offered it"));
});

test("a removed profile another Mac still uses stays there, and that Mac lists it again everywhere", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?keptA");
  const engineC = await import("./engine.ts?keptC");
  const work = await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  await join(c, engineC);
  const workOnC = await c.with(async () => {
    const offered = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Work");
    const id = engineC.addRemoteProfile(offered.syncId);
    await engineC.syncNow();
    return id;
  });
  const syncId = await a.with(async () => {
    S().deleteProfile(work);
    await engineA.syncNow();
    await engineA.syncNow();
    const offered = engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work");
    assert.equal(engineA.removeRemoteProfile(offered.syncId), true);
    await engineA.syncNow();
    return offered.syncId;
  });
  assert.equal(live("prof:", syncId), false, "the removal went out");
  await c.with(async () => {
    await engineC.syncNow();
    await engineC.syncNow();
    assert.equal(S().profiles[workOnC]?.name, "Work", "the Mac that uses it keeps it");
    assert.equal(S().profiles[workOnC].dataId, "default", "with its shared data");
  });
  assert.equal(live("prof:", syncId), true, "that Mac publishes the profile again");
  assert.equal(live("share:", syncId), true, "and the data it shares");
  await a.with(async () => {
    await engineA.syncNow();
    await engineA.syncNow();
    assert.ok(engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work"), "it's offered again, since a Mac still has it");
  });
});

test("only a profile that isn't on this Mac can be removed from sync", async () => {
  folder.clear();
  const a = new Mac("A");
  const engineA = await import("./engine.ts?onlyRemote");
  const work = await a.with(() => S().createProfile({ name: "Work" }));
  await turnOn(a, engineA);
  await a.with(async () => {
    const syncId = engineA.useSync.getState().profiles[work].syncId;
    assert.equal(engineA.removeRemoteProfile(syncId), false, "a profile on this Mac is turned off in its row, not removed");
    assert.equal(engineA.removeRemoteProfile("nope"), false);
    await engineA.syncNow();
    assert.equal(live("prof:", syncId), true);
  });
});
