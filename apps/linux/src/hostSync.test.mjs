import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import {
  HELD_LOGINS_DOCUMENT,
  SYNC_CAPABILITIES,
  configureHeldLogins,
  createHeldLogins,
  keyringResumer,
  newSyncDeviceId,
  refreshSyncDocuments,
  whileResettingHeldLogins,
  syncModuleMethod,
} from "./hostSync.ts";
import { NO_AUTHORITY_MESSAGE, REMOTE_METHODS, startSyncAuthority } from "./syncAuthority.ts";

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";
const fast = { set: (callback, ms) => setTimeout(callback, Math.min(ms, 15)), clear: (handle) => clearTimeout(handle) };
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeHost(reply = () => null) {
  const calls = [];
  return {
    calls,
    bootstrap: { windowId: "w1", profileId: "default", capabilities: [...SYNC_CAPABILITIES] },
    call: async () => "{}",
    invoke: async (method, args) => (calls.push({ method, args }), reply(method, args)),
    onEvent: () => () => {},
  };
}

function store(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState(next, replace) {
      state = replace ? next : { ...state, ...next };
      for (const listener of listeners) listener(state);
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
}

function nativeLease(ttl = 200) {
  let holder = "", expires = 0;
  return {
    claim(caller) {
      if (holder && holder !== caller && Date.now() < expires) return { granted: false };
      holder = caller;
      expires = Date.now() + ttl;
      return { granted: true };
    },
    release: (caller) => void (holder === caller && (holder = "")),
    holds: (caller) => holder === caller && Date.now() < expires,
  };
}

function renderer(name, { candidate, lease, engines, channelName }) {
  const mirror = store({ status: "starting", error: null, folder: null });
  const log = [];
  const authority = startSyncAuthority({
    id: name, candidate, channel: new BroadcastChannel(channelName), mirror, timers: fast, report: () => {},
    claim: async () => lease.claim(name),
    release: async () => lease.release(name),
    become: async () => {
      engines.push(name);
      const real = store({ status: "off", error: null, folder: null, owner: name });
      const remote = Object.fromEntries(REMOTE_METHODS.map((method) => [method, async (...args) => {
        log.push(method);
        if (!lease.holds(name)) throw new Error("ERR_SYNC_NOT_AUTHORITY");
        if (method === "turnOnSync") real.setState({ ...real.getState(), status: "starting", folder: args[0] }, true);
        return method === "turnOnSync" || method === "enterRecoveryPhrase" ? { ok: true } : null;
      }]));
      return { store: real, remote };
    },
  });
  return { authority, mirror, log };
}

function heldIo(docs = new Map(), { openFails = false } = {}) {
  return {
    docs,
    read: (name) => docs.get(name) ?? null,
    save: async (name, text) => void docs.set(name, text),
    remove: async (name) => void docs.delete(name),
    seal: async (text) => `sealed:${Buffer.from(text).toString("base64")}`,
    open: async (sealed) => (openFails ? null : Buffer.from(sealed.slice(7), "base64").toString()),
  };
}

test("saved passwords go only through the typed native path for the window's profile, and only once a held store exists", async () => {
  const sealedList = [{ origin: "https://bank.example", username: "alice", sealed: "AdGh", created: 1700000000000 }];
  const host = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? sealedList : method === "ArdiaSync.savePassword" ? true : null));
  const read = syncModuleMethod(host, "ArdiaSync", "readPasswords");
  assert.equal(await read(""), null);
  assert.deepEqual(host.calls, []);
  configureHeldLogins(createHeldLogins(heldIo()));
  try {
    assert.deepEqual(await read("work"), sealedList);
    assert.equal(await syncModuleMethod(host, "ArdiaSync", "savePassword")("", "https://bank.example", "alice", "AdGh", true), true);
  } finally {
    configureHeldLogins(null);
  }
  assert.deepEqual(host.calls, [
    { method: "ArdiaSync.readPasswords", args: { args: ["work"] } },
    { method: "ArdiaSync.savePassword", args: { args: ["default", "https://bank.example", "alice", "AdGh", true] } },
  ]);
  assert.equal(syncModuleMethod(host, "ArdiaPasswords", "write"), undefined);
});

test("a held login is sealed at rest and hides the local value it replaced across restarts until that value really changes", async () => {
  const io = heldIo();
  const v1 = { origin: "https://bank.example", username: "alice", sealed: "V1", created: 5 };
  assert.equal(await createHeldLogins(io).hold("", { origin: v1.origin, username: "alice", sealed: "LONG", replaced: "V1" }), true);
  const stored = io.docs.get(HELD_LOGINS_DOCUMENT);
  assert.ok(stored.startsWith("sealed:") && !stored.includes("bank.example") && !stored.includes("LONG"));
  const restarted = createHeldLogins(io);
  assert.deepEqual(await restarted.merge("", [v1]), [{ origin: v1.origin, username: "alice", sealed: "LONG", created: 0 }]);
  assert.deepEqual(await restarted.merge("work", [v1]), [v1]);
  const edited = { ...v1, sealed: "V2", created: 9 };
  assert.deepEqual(await restarted.merge("", [edited]), [edited]);
  assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
  const locked = createHeldLogins(heldIo(new Map([[HELD_LOGINS_DOCUMENT, "sealed:e30="]]), { openFails: true }));
  assert.equal(await locked.merge("", [v1]), null);
});

test("a key reset suspends the held store while it runs and clears it only when the engine began a new document", async () => {
  const io = heldIo();
  const read = syncModuleMethod(fakeHost((method) => (method === "ArdiaSync.readPasswords" ? [] : null)), "ArdiaSync", "readPasswords");
  const held = createHeldLogins(io);
  configureHeldLogins(held);
  try {
    await held.hold("", { origin: "https://long.example", username: "lee", sealed: "REMOTE", replaced: null });
    await whileResettingHeldLogins(async () => {
      assert.equal(await read(""), null);
      return { error: "checksum" };
    }, (result) => "ok" in result);
    assert.equal((await read("")).length, 1);
    await whileResettingHeldLogins(async () => ({ ok: true }), (result) => "ok" in result);
    assert.deepEqual(await read(""), []);
    assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
  } finally {
    configureHeldLogins(null);
  }
});

test("the sync module keeps device ids local and sends every other call as a typed sync invoke", async () => {
  const host = fakeHost(() => true);
  assert.match(syncModuleMethod(host, "ArdiaSync", "newDeviceId")(), /^[a-z2-7]{26}$/);
  assert.equal(newSyncDeviceId((bytes) => bytes.fill(0)), "aaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(syncModuleMethod(host, "ArdiaSync", "nope"), undefined);
  await resolveHostModule(host, "ArdiaSync", "folderInfo")(undefined);
  await resolveHostModule(host, "ArdiaSync", "enterPhrase")("aaaaaaaaaaaaaaaaaaaaaaaaaa", PHRASE, "/sync");
  assert.deepEqual(host.calls, [
    { method: "ArdiaSync.folderInfo", args: { args: [null] } },
    { method: "ArdiaSync.enterPhrase", args: { args: ["aaaaaaaaaaaaaaaaaaaaaaaaaa", PHRASE, "/sync"] } },
  ]);
});

test("opening a keyring that was locked at launch resumes sync once from the stored key", async () => {
  const secret = (keyStoreStatus, lastKeyStatus) => ({ keyStore: "secretService", keyStoreStatus, lastKeyStatus, unlocked: false, unreadable: false, passwords: false });
  const replies = [secret("locked", "locked"), secret("ok", "locked"), secret("ok", "notFound")];
  let resumed = 0;
  const tickOnce = keyringResumer({ locked: () => true, status: async () => replies.shift(), seen: () => {}, resume: async () => void resumed++ });
  assert.deepEqual([await tickOnce(), await tickOnce(), await tickOnce()], [false, true, false]);
  assert.equal(resumed, 1);
});

test("one renderer runs sync, the others mirror it and forward their actions, and it fails over when that window closes", async () => {
  const channelName = `sync-${Math.random()}`;
  const lease = nativeLease();
  const engines = [];
  const a = renderer("a", { candidate: true, lease, engines, channelName });
  const b = renderer("b", { candidate: true, lease, engines, channelName });
  const settings = renderer("settings", { candidate: false, lease, engines, channelName });
  await tick(80);
  assert.deepEqual(engines, ["a"]);
  assert.equal(settings.authority.role(), "client");
  assert.deepEqual(await settings.authority.call("turnOnSync", ["/home/tux/Sync"]), { ok: true });
  assert.deepEqual(a.log, ["turnOnSync"]);
  await tick();
  assert.equal(settings.mirror.getState().folder, "/home/tux/Sync");
  a.authority.stop();
  await tick(300);
  assert.deepEqual(engines, ["a", "b"]);
  assert.equal(await settings.authority.call("syncNow", []), null);
  assert.deepEqual(b.log, ["syncNow"]);
  b.authority.stop();
  await tick(60);
  await assert.rejects(settings.authority.call("syncNow", []), { message: NO_AUTHORITY_MESSAGE });
  settings.authority.stop();
});

test("refreshing sync documents drops journal parts stranded after a gap", async () => {
  const disk = new Set(["sync.json", "sync-state.nns", "sync-journal-1.nns", "sync-journal-2.nns", "sync-journal-4.nns", "sync-journal-7.nns"]);
  const result = await refreshSyncDocuments({ refresh: async (name) => disk.has(name), remove: async (name) => void disk.delete(name), maxParts: 12, batch: 5 });
  assert.deepEqual(result, { parts: 2, removed: ["sync-journal-4.nns", "sync-journal-7.nns"] });
});
