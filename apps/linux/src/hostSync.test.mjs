import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { credentialModuleMethod } from "./hostCredentials.ts";
import { createHostDocuments } from "./hostDocuments.ts";
import { resolveHostModule } from "./hostModules.ts";
import {
  HELD_LOGINS_DOCUMENT,
  SYNC_CAPABILITIES,
  configureHeldLogins,
  createHeldLogins,
  base32,
  keyringMessage,
  keyringResumer,
  watchLockedSync,
  loadSyncDeviceName,
  newSyncDeviceId,
  presentSyncState,
  refreshSyncDocuments,
  HeldLoginsResetError,
  enterPhraseBegins,
  releaseHeldLogin,
  whileResettingHeldLogins,
  syncDeviceName,
  syncModuleMethod,
  withChosenSyncFolder,
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
    invoke: async (method, args) => {
      calls.push({ method, args });
      return reply(method, args);
    },
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function fakeLocks() {
  let held = false;
  const queue = [];
  return {
    request(_name, _options, callback) {
      return new Promise((resolve, reject) => {
        const run = async () => {
          held = true;
          try {
            resolve(await callback());
          } catch (error) {
            reject(error);
          } finally {
            held = false;
            queue.shift()?.();
          }
        };
        if (held) queue.push(run);
        else void run();
      });
    },
  };
}

function nativeLease(ttl = 200) {
  let holder = "";
  let expires = 0;
  return {
    claims: [],
    claim(caller) {
      this.claims.push(caller);
      const now = Date.now();
      if (holder && holder !== caller && now < expires) return { granted: false };
      holder = caller;
      expires = now + ttl;
      return { granted: true };
    },
    release(caller) {
      if (holder === caller) holder = "";
    },
    holds: (caller) => holder === caller && Date.now() < expires,
  };
}

function renderer(name, { candidate, locks, lease, engines, channelName }) {
  const mirror = store({ status: "starting", error: null, folder: null });
  const log = [];
  const authority = startSyncAuthority({
    id: name,
    candidate,
    locks,
    channel: new BroadcastChannel(channelName),
    mirror,
    timers: fast,
    report: () => {},
    claim: async () => lease.claim(name),
    release: async () => lease.release(name),
    become: async () => {
      engines.push(name);
      const real = store({ status: "off", error: null, folder: null, owner: name });
      const remote = Object.fromEntries(REMOTE_METHODS.map((method) => [method, async (...args) => {
        log.push([method, args]);
        if (!lease.holds(name)) throw new Error("ERR_SYNC_NOT_AUTHORITY");
        if (method === "turnOnSync") real.setState({ ...real.getState(), status: "starting", folder: args[0] }, true);
        return method === "turnOnSync" ? { ok: true } : method === "enterRecoveryPhrase" ? { ok: true } : null;
      }]));
      return { store: real, remote };
    },
  });
  return { name, authority, mirror, log };
}

function heldIo(docs = new Map(), { sealFails = false, openFails = false } = {}) {
  return {
    docs,
    read: (name) => docs.get(name) ?? null,
    save: async (name, text) => void docs.set(name, text),
    remove: async (name) => void docs.delete(name),
    seal: async (text) => (sealFails ? null : `sealed:${Buffer.from(text).toString("base64")}`),
    open: async (sealed) => (openFails ? null : Buffer.from(sealed.slice(7), "base64").toString()),
  };
}

const withHeld = async (store, run) => {
  configureHeldLogins(store);
  try {
    return await run();
  } finally {
    configureHeldLogins(null);
  }
};

test("saved passwords go to the sync authority's typed native path for the window's profile, and only sealed values cross into JS", async () => {
  const sealedList = [{ origin: "https://bank.example", username: "alice", sealed: "AdGh", created: 1700000000000 }];
  const host = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? sealedList : method === "ArdiaSync.savePassword" ? true : null));
  const read = syncModuleMethod(host, "ArdiaSync", "readPasswords");
  const save = syncModuleMethod(host, "ArdiaSync", "savePassword");
  assert.equal(await read(""), null);
  assert.deepEqual(host.calls, []);
  await withHeld(createHeldLogins(heldIo()), async () => {
    assert.deepEqual(await read(""), sealedList);
    assert.deepEqual(await read("work"), sealedList);
    assert.equal(await save("", "https://bank.example", "alice", "AdGh", true), true);
  });
  assert.deepEqual(host.calls, [
    { method: "ArdiaSync.readPasswords", args: { args: ["default"] } },
    { method: "ArdiaSync.readPasswords", args: { args: ["work"] } },
    { method: "ArdiaSync.savePassword", args: { args: ["default", "https://bank.example", "alice", "AdGh", true] } },
  ]);
  const refused = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? null : false));
  await withHeld(createHeldLogins(heldIo()), async () => {
    assert.equal(await syncModuleMethod(refused, "ArdiaSync", "readPasswords")(""), null);
    assert.equal(await syncModuleMethod(refused, "ArdiaSync", "savePassword")("", "https://bank.example", "alice", "AdGh", false), false);
  });
});

test("a held login keeps hiding the local value it replaced, across restarts, until the local value really changes", async () => {
  const io = heldIo();
  const held = createHeldLogins(io);
  const v1 = { origin: "https://bank.example", username: "alice", sealed: "V1", created: 5 };
  const long = { origin: "https://bank.example", username: "alice", sealed: "LONG", replaced: "V1" };
  assert.deepEqual(await held.merge("", [v1]), [v1]);
  assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
  assert.equal(await held.hold("", long), true);
  const stored = io.docs.get(HELD_LOGINS_DOCUMENT);
  assert.ok(stored.startsWith("sealed:") && !stored.includes("bank.example") && !stored.includes("LONG"));
  const restarted = createHeldLogins(io);
  const reported = [{ origin: "https://bank.example", username: "alice", sealed: "LONG", created: 0 }];
  assert.deepEqual(await restarted.merge("", [v1]), reported);
  assert.deepEqual(await restarted.merge("", []), reported);
  assert.deepEqual(await restarted.merge("work", [v1]), [v1]);
  assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), true);
  const edited = { ...v1, sealed: "V2", created: 9 };
  assert.deepEqual(await restarted.merge("", [edited]), [edited]);
  assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);

  const lee = { origin: "https://long.example", username: "lee", sealed: "REMOTE", replaced: null };
  assert.equal(await restarted.hold("", lee), true);
  const leeSaved = { origin: "https://long.example", username: "lee", sealed: "SAVED", created: 3 };
  assert.deepEqual(await restarted.merge("", [leeSaved]), [leeSaved]);
  assert.equal(await restarted.hold("", lee), true);
  assert.equal(await restarted.release("", lee.origin, lee.username), true);
  assert.equal(await restarted.release("", lee.origin, lee.username), false);
  assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
  assert.equal(await held.merge("", null), null);

  const locked = createHeldLogins(heldIo(new Map([[HELD_LOGINS_DOCUMENT, "sealed:e30="]]), { openFails: true }));
  assert.equal(await locked.merge("", [v1]), null);
  assert.equal(await locked.hold("", long), false);
  await locked.clear();
  assert.deepEqual(await locked.merge("", [v1]), [v1]);
  const corrupt = createHeldLogins(heldIo(new Map([[HELD_LOGINS_DOCUMENT, `sealed:${Buffer.from("[1,2]").toString("base64")}`]])));
  assert.equal(await corrupt.merge("", [v1]), null);
  assert.equal(await createHeldLogins(heldIo(new Map(), { sealFails: true })).hold("", long), false);
});

test("the held store is capped by count and bytes, refuses past the cap without throwing, and reports how many it holds", async () => {
  const held = createHeldLogins(heldIo(), { maxLogins: 2, maxBytes: 1_000_000 });
  for (const name of ["a", "b"]) assert.equal(await held.hold("", { origin: `https://${name}.example`, username: name, sealed: "S", replaced: null }), true);
  assert.equal(await held.hold("", { origin: "https://c.example", username: "c", sealed: "S", replaced: null }), false);
  assert.equal(await held.hold("", { origin: "https://c.example", username: "c", sealed: "S", replaced: null }), false);
  assert.equal(await held.hold("work", { origin: "https://c.example", username: "c", sealed: "S", replaced: null }), false);
  assert.equal(await held.hold("", { origin: "https://a.example", username: "a", sealed: "S2", replaced: null }), true);
  assert.deepEqual(held.status(), { held: 2, refused: 2 });
  assert.equal(await held.release("", "https://b.example", "b"), true);
  assert.equal(await held.hold("", { origin: "https://c.example", username: "c", sealed: "S", replaced: null }), true);
  assert.deepEqual(held.status(), { held: 2, refused: 1 });
  const small = createHeldLogins(heldIo(), { maxLogins: 100, maxBytes: 300 });
  assert.equal(await small.hold("", { origin: "https://a.example", username: "a", sealed: "S".repeat(100), replaced: null }), true);
  assert.equal(await small.hold("", { origin: "https://b.example", username: "b", sealed: "S".repeat(200), replaced: null }), false);
  assert.deepEqual(small.status(), { held: 1, refused: 1 });
});

test("held logins of a deleted profile are dropped, and other profiles keep theirs", async () => {
  const io = heldIo();
  const held = createHeldLogins(io);
  for (const profile of ["", "work", "gone"]) await held.hold(profile, { origin: "https://a.example", username: profile, sealed: "S", replaced: null });
  await held.dropProfiles([]);
  assert.equal(held.status().held, 3);
  await held.dropProfiles(["gone", "never-held"]);
  assert.equal(held.status().held, 2);
  assert.deepEqual(await createHeldLogins(io).merge("gone", []), []);
  assert.equal((await createHeldLogins(io).merge("work", [])).length, 1);
});

test("a failed native remove releases a held login only when a fresh native read no longer has it", async () => {
  let native = [{ origin: "https://bank.example", username: "alice", sealed: "V1", created: 5 }];
  const host = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? native : method === "ArdiaSync.savePassword" ? "skipped" : null));
  host.call = async () => {
    throw Object.assign(new Error("The password store is unavailable"), { code: "ERR_PASSWORDS_UNAVAILABLE" });
  };
  const save = syncModuleMethod(host, "ArdiaSync", "savePassword");
  const read = syncModuleMethod(host, "ArdiaSync", "readPasswords");
  const remove = (origin, username) => credentialModuleMethod(host, "ArdiaPasswords", "call")("remove", "", JSON.stringify({ origin, username }));
  await withHeld(createHeldLogins(heldIo()), async () => {
    assert.equal(await save("", "https://bank.example", "alice", "LONG", true), true);
    await assert.rejects(remove("https://bank.example", "alice"), /unavailable/);
    assert.deepEqual(await read(""), [{ origin: "https://bank.example", username: "alice", sealed: "LONG", created: 0 }]);
    native = null;
    await assert.rejects(remove("https://bank.example", "alice"), /unavailable/);
    native = [];
    assert.deepEqual(JSON.parse(await remove("https://bank.example", "alice")), { ok: true });
    assert.deepEqual(await read(""), []);
  });
});

test("the sync adapter holds a login the native save skipped with the local value it replaced, and a delete releases it even when the native remove refuses", async () => {
  const local = [{ origin: "https://bank.example", username: "alice", sealed: "V1", created: 5 }];
  let saveReply = "skipped";
  let removeFails = false;
  const host = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? local : method === "ArdiaSync.savePassword" ? saveReply : null));
  host.call = async () => {
    if (removeFails) throw Object.assign(new Error("A username of bounded length is required"), { code: "ERR_CREDENTIAL_REQUEST" });
    return JSON.stringify({ ok: true });
  };
  const save = syncModuleMethod(host, "ArdiaSync", "savePassword");
  const read = syncModuleMethod(host, "ArdiaSync", "readPasswords");
  const remove = (origin, username) => credentialModuleMethod(host, "ArdiaPasswords", "call")("remove", "", JSON.stringify({ origin, username }));
  assert.equal(await save("", "https://bank.example", "alice", "LONG", true), false);
  const io = heldIo();
  await withHeld(createHeldLogins(io), async () => {
    assert.equal(await save("", "https://bank.example", "alice", "LONG", true), true);
    assert.deepEqual(await read(""), [{ origin: "https://bank.example", username: "alice", sealed: "LONG", created: 0 }]);
    assert.equal(await save("", "https://long.example", "lee", "REMOTE", false), true);
    removeFails = true;
    assert.deepEqual(JSON.parse(await remove("https://long.example", "lee")), { ok: true });
    await assert.rejects(remove("https://other.example", "x"), /bounded length/);
    removeFails = false;
    assert.deepEqual(await read(""), [{ origin: "https://bank.example", username: "alice", sealed: "LONG", created: 0 }]);
    saveReply = true;
    assert.equal(await save("", "https://bank.example", "alice", "SHORT", true), true);
    assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
    saveReply = false;
    assert.equal(await save("", "https://bank.example", "alice", "BROKEN", true), false);
    assert.equal(await releaseHeldLogin("", "https://nowhere.example", "x"), false);
  });
});

test("a key reset suspends the held store while it runs and clears it only when the engine began a new document", async () => {
  const io = heldIo();
  const host = fakeHost((method) => (method === "ArdiaSync.readPasswords" ? [] : null));
  const read = syncModuleMethod(host, "ArdiaSync", "readPasswords");
  const store = createHeldLogins(io);
  await withHeld(store, async () => {
    await store.hold("", { origin: "https://long.example", username: "lee", sealed: "REMOTE", replaced: null });
    const failed = await whileResettingHeldLogins(async () => {
      assert.equal(await read(""), null);
      return { error: "checksum" };
    }, (result) => "ok" in result);
    assert.deepEqual(failed, { error: "checksum" });
    assert.equal((await read("")).length, 1);
    await assert.rejects(whileResettingHeldLogins(async () => { throw new Error("boom"); }, () => true), /boom/);
    assert.equal((await read("")).length, 1);
    await whileResettingHeldLogins(async () => ({ ok: true }), (result) => "ok" in result);
    assert.deepEqual(await read(""), []);
    assert.equal(io.docs.has(HELD_LOGINS_DOCUMENT), false);
  });
  const stuck = heldIo();
  stuck.remove = async () => {
    throw new Error("disk full");
  };
  const stuckStore = createHeldLogins(stuck);
  let rolledBack = 0;
  await withHeld(stuckStore, async () => {
    await assert.rejects(
      whileResettingHeldLogins(async () => ({ ok: true }), () => true, async () => void rolledBack++),
      (error) => error instanceof HeldLoginsResetError,
    );
    assert.equal(rolledBack, 1);
    assert.deepEqual(await read(""), []);
  });
  assert.equal(enterPhraseBegins({ enabled: true, status: "locked" }), false);
  for (const status of ["updated", "stalled", "starting", "offline"]) assert.equal(enterPhraseBegins({ enabled: true, status }), true);
  assert.equal(enterPhraseBegins({ enabled: false, status: "locked" }), true);
});

test("the sync module adapter keeps device ids local and sends every other call as a typed sync invoke", async () => {
  const host = fakeHost((method) => (method === "ArdiaSync.deviceName" ? "  tux-laptop  " : method === "ArdiaSync.folderInfo" ? { path: "/x" } : true));
  const id = syncModuleMethod(host, "ArdiaSync", "newDeviceId")();
  assert.match(id, /^[a-z2-7]{26}$/);
  assert.notEqual(id, syncModuleMethod(host, "ArdiaSync", "newDeviceId")());
  assert.equal(base32(new Uint8Array([0xff, 0, 0x55])), "74afk");
  assert.equal(newSyncDeviceId((bytes) => bytes.fill(0)), "aaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(syncDeviceName(), "Linux");
  assert.equal(await loadSyncDeviceName(host), "tux-laptop");
  assert.equal(syncModuleMethod(host, "ArdiaSync", "deviceName")(), "tux-laptop");
  assert.equal(syncModuleMethod(host, "ArdiaSync", "nope"), undefined);
  assert.equal(syncModuleMethod(host, "ArdiaPasswords", "write"), undefined);
  host.calls.length = 0;
  await resolveHostModule(host, "ArdiaSync", "write")("/sync", "app", "{}");
  await resolveHostModule(host, "ArdiaSync", "folderInfo")(undefined);
  await resolveHostModule(host, "ArdiaSync", "enterPhrase")("aaaaaaaaaaaaaaaaaaaaaaaaaa", PHRASE, "/sync");
  assert.deepEqual(host.calls, [
    { method: "ArdiaSync.write", args: { args: ["/sync", "app", "{}"] } },
    { method: "ArdiaSync.folderInfo", args: { args: [null] } },
    { method: "ArdiaSync.enterPhrase", args: { args: ["aaaaaaaaaaaaaaaaaaaaaaaaaa", PHRASE, "/sync"] } },
  ]);
  assert.equal(host.calls.some((call) => call.method.startsWith("engine.")), false);
});

test("a folder chosen in another window is handed to the authority's picker exactly once", async () => {
  const host = fakeHost(() => "/from-native-picker");
  const choose = syncModuleMethod(host, "ArdiaSync", "chooseFolder");
  const picked = await withChosenSyncFolder("/home/tux/Sync", async () => [await choose("/old"), await choose("/old")]);
  assert.deepEqual(picked, ["/home/tux/Sync", "/from-native-picker"]);
  assert.equal(await choose(null), "/from-native-picker");
  assert.deepEqual(host.calls.map((call) => call.args), [{ args: ["/old"] }, { args: [null] }]);
});

test("keyring problems read as keyring problems, not as a Keychain on a Mac", () => {
  const secret = (keyStoreStatus, lastKeyStatus = keyStoreStatus) => ({ keyStore: "secretService", keyStoreStatus, lastKeyStatus, unlocked: false, unreadable: false, passwords: false });
  assert.match(keyringMessage(secret("unavailable"), true), /no keyring is running/);
  assert.match(keyringMessage(secret("ok", "locked"), true), /keyring is locked/);
  assert.equal(keyringMessage(secret("ok"), true), null);
  assert.equal(keyringMessage({ ...secret("unavailable"), keyStore: "file" }, false), null);
  const locked = { status: "locked", error: "Enter your recovery phrase to keep syncing on this Mac." };
  assert.match(presentSyncState(locked, secret("unavailable")).error, /Start a Secret Service keyring/);
  assert.equal(presentSyncState(locked, secret("ok")), locked);
  assert.equal(presentSyncState({ status: "updated", error: null }, secret("unavailable")).error, null);
});

test("a keyring locked at launch is named in the Sync pane, and opening it resumes sync from the stored key without the phrase", async () => {
  const secret = (keyStoreStatus, lastKeyStatus) => ({ keyStore: "secretService", keyStoreStatus, lastKeyStatus, unlocked: false, unreadable: false, passwords: false });
  const locked = { status: "locked", error: "Enter your recovery phrase to keep syncing on this device." };
  assert.equal(presentSyncState(locked, secret("locked", "locked")).error, "Your keyring is locked. Unlock it, or enter your recovery phrase to keep syncing.");
  const replies = [secret("locked", "locked"), secret("locked", "locked"), secret("ok", "locked"), secret("ok", "notFound")];
  const seen = [];
  let resumed = 0;
  let uiLocked = true;
  const tickOnce = keyringResumer({
    locked: () => uiLocked,
    status: async () => replies.shift(),
    seen: (status) => seen.push(`${status.keyStoreStatus}/${status.lastKeyStatus}`),
    resume: async () => void resumed++,
  });
  assert.equal(await tickOnce(), false);
  assert.equal(await tickOnce(), false);
  assert.equal(resumed, 0);
  assert.equal(await tickOnce(), true);
  assert.equal(resumed, 1);
  assert.equal(await tickOnce(), false);
  assert.equal(resumed, 1);
  assert.deepEqual(seen, ["locked/locked", "locked/locked", "ok/locked", "ok/notFound"]);
  uiLocked = false;
  assert.equal(await tickOnce(), false);
  assert.equal(seen.length, 4);

  let release;
  const slow = keyringResumer({ locked: () => true, status: () => new Promise((resolve) => (release = resolve)), seen: () => {}, resume: async () => void resumed++ });
  const first = slow();
  assert.equal(await slow(), false);
  release(secret("ok", "locked"));
  assert.equal(await first, true);
  const file = keyringResumer({ locked: () => true, status: async () => ({ ...secret("ok", "locked"), keyStore: "file" }), seen: () => {}, resume: async () => void resumed++ });
  assert.equal(await file(), false);
  const failing = keyringResumer({ locked: () => true, status: async () => { throw new Error("gone"); }, seen: () => {}, resume: async () => void resumed++ });
  assert.equal(await failing(), false);
  assert.equal(resumed, 2);

  const engine = readFileSync(new URL("./syncEngine.ts", import.meta.url), "utf8");
  const become = engine.slice(engine.indexOf("async function becomeAuthority"), engine.indexOf("export function startLinuxSync"));
  assert.ok(become.indexOf("engine.startSync();") < become.indexOf("resumeWhenKeyringOpens(host);"));
  const watch = engine.slice(engine.indexOf("function resumeWhenKeyringOpens"), engine.indexOf("function dropDeletedProfiles"));
  assert.match(watch, /authority\?\.isAuthority\(\) && state\.enabled && state\.status === "locked"/);
  assert.match(watch, /resume: \(\) => engine\.enterRecoveryPhrase\(engine\.useSync\.getState\(\)\.folder \?\? "", ""\)/);
  assert.match(watch, /watchLockedSync\(engine\.useSync, tick, KEYRING_RETRY_MS\)/);
  const start = engine.slice(engine.indexOf("export function startLinuxSync"), engine.indexOf("export const linuxSyncHooks"));
  assert.match(start, /onRole: \(role\) => \{\n\s+if \(role !== "authority"\) \{\n\s+dropHeldLogins\(\);\n\s+stopKeyringWatch\(\);/);
  assert.match(start, /addEventListener\("pagehide", \(\) => \{\n\s+stopKeyringWatch\(\);\n\s+started\.stop\(\);/);
});

test("a window holding the sync key in memory resumes even when the held key was saved before the poll saw it", async () => {
  const secret = (keyStoreStatus, lastKeyStatus, unlocked) => ({ keyStore: "secretService", keyStoreStatus, lastKeyStatus, unlocked, unreadable: false, passwords: false });
  const replies = [secret("locked", "locked", true), secret("ok", "ok", true), secret("ok", "ok", false), secret("ok", "ok", true)];
  let resumed = 0;
  const tickOnce = keyringResumer({ locked: () => true, status: async () => replies.shift(), seen: () => {}, resume: async () => void resumed++ });
  assert.equal(await tickOnce(), true);
  assert.equal(await tickOnce(), false);
  assert.equal(await tickOnce(), false);
  assert.equal(await tickOnce(), true);
  assert.equal(resumed, 2);
});

test("the keyring poll runs only while sync is on and locked, and stops for good when the window stops running sync", () => {
  let state = { enabled: true, status: "starting" };
  const listeners = new Set();
  const store = { getState: () => state, subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)) };
  const set = (next) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };
  const timers = new Map();
  let ids = 0;
  const clock = { set: (run, ms) => (timers.set(++ids, { run, ms }), ids), clear: (id) => timers.delete(id) };
  let ticks = 0;
  const stop = watchLockedSync(store, () => void ticks++, 3000, clock);
  assert.equal(timers.size, 0);
  set({ status: "locked" });
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 3000);
  [...timers.values()][0].run();
  assert.equal(ticks, 1);
  set({ status: "locked", error: "x" });
  assert.equal(timers.size, 1);
  set({ status: "updated" });
  assert.equal(timers.size, 0);
  set({ status: "locked" });
  assert.equal(timers.size, 1);
  set({ enabled: false, status: "off" });
  assert.equal(timers.size, 0);
  set({ enabled: true, status: "locked" });
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
  set({ status: "locked" });
  assert.equal(timers.size, 0);
});

test("one renderer runs sync, the others mirror it and forward their actions, and it fails over when that window closes", async () => {
  const channelName = `sync-${Math.random()}`;
  const locks = fakeLocks();
  const lease = nativeLease();
  const engines = [];
  const a = renderer("a", { candidate: true, locks, lease, engines, channelName });
  const b = renderer("b", { candidate: true, locks, lease, engines, channelName });
  const settings = renderer("settings", { candidate: false, locks, lease, engines, channelName });
  const privateWindow = renderer("private", { candidate: false, locks, lease, engines, channelName });
  await tick(80);
  assert.deepEqual(engines, ["a"]);
  assert.equal(a.authority.role(), "authority");
  assert.equal(b.authority.role(), "claiming");
  assert.equal(settings.authority.role(), "client");
  assert.equal(settings.mirror.getState().owner, "a");
  assert.equal(lease.claims.includes("settings") || lease.claims.includes("private"), false);

  assert.deepEqual(await settings.authority.call("turnOnSync", ["/home/tux/Sync"]), { ok: true });
  assert.deepEqual(await b.authority.call("enterRecoveryPhrase", ["/home/tux/Sync", PHRASE]), { ok: true });
  assert.deepEqual(a.log.map(([method]) => method), ["turnOnSync", "enterRecoveryPhrase"]);
  assert.equal(settings.log.length + b.log.length + privateWindow.log.length, 0);
  await tick();
  assert.equal(settings.mirror.getState().folder, "/home/tux/Sync");
  assert.equal(privateWindow.mirror.getState().folder, "/home/tux/Sync");
  await assert.rejects(settings.authority.call("evaluate", []), new RegExp(NO_AUTHORITY_MESSAGE.slice(0, 20)));

  a.authority.stop();
  await tick(120);
  assert.deepEqual(engines, ["a", "b"]);
  assert.equal(b.authority.role(), "authority");
  assert.equal(settings.mirror.getState().owner, "b");
  assert.equal(await settings.authority.call("syncNow", []), null);
  assert.deepEqual(b.log.map(([method]) => method), ["syncNow"]);

  b.authority.stop();
  await tick(60);
  await assert.rejects(settings.authority.call("syncNow", []), { message: NO_AUTHORITY_MESSAGE });
  settings.authority.stop();
  privateWindow.authority.stop();
});

test("a candidate waits for a stale native lease to expire before starting sync", async () => {
  const channelName = `sync-${Math.random()}`;
  const lease = nativeLease(150);
  lease.claim("reloaded-window#1");
  const engines = [];
  const fresh = renderer("reloaded-window#2", { candidate: true, locks: fakeLocks(), lease, engines, channelName });
  await tick(60);
  assert.deepEqual(engines, []);
  assert.equal(fresh.authority.role(), "claiming");
  await tick(250);
  assert.deepEqual(engines, ["reloaded-window#2"]);
  fresh.authority.stop();
});

test("without Web Locks the native lease alone keeps a single authority", async () => {
  const channelName = `sync-${Math.random()}`;
  const lease = nativeLease(5000);
  const engines = [];
  const first = renderer("first", { candidate: true, lease, engines, channelName });
  const second = renderer("second", { candidate: true, lease, engines, channelName });
  await tick(120);
  assert.deepEqual(engines, ["first"]);
  assert.equal(second.authority.role(), "claiming");
  first.authority.stop();
  second.authority.stop();
});

test("a private window is refused natively and never becomes the authority", async () => {
  const mirror = store({ status: "starting", error: null });
  const roles = [];
  const authority = startSyncAuthority({
    id: "private",
    candidate: true,
    channel: null,
    mirror,
    timers: fast,
    report: () => {},
    claim: async () => {
      throw Object.assign(new Error("Sync isn't available in private windows"), { code: "ERR_PRIVATE_SERVICE" });
    },
    release: async () => {},
    become: async () => assert.fail("a private window started sync"),
    onRole: (role) => roles.push(role),
  });
  await tick();
  assert.deepEqual(roles, ["unavailable"]);
  await assert.rejects(authority.call("syncNow", []), { message: NO_AUTHORITY_MESSAGE });
  authority.stop();
});

test("refreshing a stored document waits for queued writes and mirrors deletions", async () => {
  const disk = new Map([["sync.json", "{\"v\":1,\"enabled\":true}"]]);
  const order = [];
  const host = {
    bootstrap: { windowId: "w", profileId: "default", documents: { "sync.json": "{\"v\":1,\"enabled\":false}", "sync-journal-1.nns": "stale" } },
    invoke: async (method, { args }) => {
      order.push(`${method}:${args[0]}`);
      if (method === "ArdiaShell.writeDocument") {
        await tick(10);
        disk.set(args[0], args[1]);
        return null;
      }
      if (method === "ArdiaShell.readDocument") return disk.get(args[0]) ?? null;
      if (method === "ArdiaShell.removeDocument") return null;
      return 42;
    },
  };
  const documents = createHostDocuments(host);
  assert.equal(documents.read("sync.json"), "{\"v\":1,\"enabled\":false}");
  void documents.write("sync-state.nns", "sealed");
  assert.equal(await documents.refresh("sync-state.nns"), true);
  assert.deepEqual(order.slice(0, 2), ["ArdiaShell.writeDocument:sync-state.nns", "ArdiaShell.readDocument:sync-state.nns"]);
  assert.equal(await documents.refresh("sync.json"), true);
  assert.equal(documents.read("sync.json"), "{\"v\":1,\"enabled\":true}");
  assert.equal(await documents.refresh("sync-journal-1.nns"), false);
  assert.equal(documents.read("sync-journal-1.nns"), null);
  assert.equal(await documents.refresh("live.json"), false);
  host.invoke = async () => 42;
  await assert.rejects(documents.refresh("sync.json"), { code: "ERR_BAD_REPLY" });
});

test("a candidate that can't start sync keeps the lock and retries with backoff", async () => {
  const channelName = `sync-${Math.random()}`;
  const lease = nativeLease(5000);
  const locks = fakeLocks();
  let attempts = 0;
  const releases = [];
  const mirror = store({ status: "starting", error: null });
  const authority = startSyncAuthority({
    id: "flaky",
    candidate: true,
    locks,
    channel: new BroadcastChannel(channelName),
    mirror,
    timers: fast,
    report: () => {},
    claim: async () => lease.claim("flaky"),
    release: async () => {
      releases.push(attempts);
      lease.release("flaky");
    },
    become: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ERR_DOCUMENT_READ");
      return { store: store({ status: "off", error: null, owner: "flaky" }), remote: Object.fromEntries(REMOTE_METHODS.map((m) => [m, async () => null])) };
    },
  });
  const engines = [];
  const other = renderer("other", { candidate: true, locks, lease, engines, channelName });
  await tick(250);
  assert.equal(attempts, 3);
  assert.deepEqual(releases, [1, 2]);
  assert.equal(authority.role(), "authority");
  assert.deepEqual(engines, []);
  authority.stop();
  other.authority.stop();
});

test("refreshing sync documents drops journal parts stranded after a gap", async () => {
  const disk = new Set(["sync.json", "sync-state.nns", "sync-journal-1.nns", "sync-journal-2.nns", "sync-journal-4.nns", "sync-journal-7.nns"]);
  const refreshed = [];
  const removed = [];
  const result = await refreshSyncDocuments({
    refresh: async (name) => {
      refreshed.push(name);
      return disk.has(name);
    },
    remove: async (name) => {
      removed.push(name);
      disk.delete(name);
    },
    maxParts: 12,
    batch: 5,
  });
  assert.deepEqual(result, { parts: 2, removed: ["sync-journal-4.nns", "sync-journal-7.nns"] });
  assert.deepEqual(removed, ["sync-journal-4.nns", "sync-journal-7.nns"]);
  assert.ok(refreshed.includes("sync.json") && refreshed.includes("sync-state.nns") && refreshed.includes("sync-journal.nns"));
  assert.equal(refreshed.filter((name) => /^sync-journal-\d+\.nns$/.test(name)).length, 12);
  await assert.rejects(refreshSyncDocuments({ refresh: async () => { throw new Error("read failed"); }, remove: async () => {}, maxParts: 3 }), /read failed/);
});

test("the sync authority owns the held-logins store only while it holds the lease, and resets it only when a new document begins", () => {
  const engine = readFileSync(new URL("./syncEngine.ts", import.meta.url), "utf8");
  const become = engine.slice(engine.indexOf("async function becomeAuthority"), engine.indexOf("export function startLinuxSync"));
  assert.match(become, /adoptHeldLogins\(\);/);
  assert.ok(become.indexOf("adoptHeldLogins();") < become.indexOf("engine.startSync()"));
  const adopt = engine.slice(engine.indexOf("function adoptHeldLogins"), engine.indexOf("function dropHeldLogins"));
  assert.match(adopt, /seal: async \(text\) => SyncNative\?\.sealLocal\(text\)/);
  assert.match(adopt, /open: async \(sealed\) => SyncNative\?\.openLocal\(sealed\)/);
  assert.match(adopt, /configureHeldLogins\(heldLogins\)/);
  assert.match(engine.slice(engine.indexOf("function dropHeldLogins")), /^function dropHeldLogins\(\) \{\n  heldLogins = null;\n  configureHeldLogins\(null\);/);
  const start = engine.slice(engine.indexOf("export function startLinuxSync"), engine.indexOf("export const linuxSyncHooks"));
  assert.match(start, /onRole: \(role\) => \{\n\s+if \(role !== "authority"\) \{\n\s+dropHeldLogins\(\);/);
  assert.match(start, /claim: async \(\) => \{\n\s+const claim = await claimSyncAuthority\(host\);\n\s+if \(!claim\.granted\) dropHeldLogins\(\);/);
  const remote = engine.slice(engine.indexOf("function remoteFor"), engine.indexOf("async function becomeAuthority"));
  assert.match(remote, /whileResettingHeldLogins\(\s*\(\) => engine\.turnOnSync\(folder\),\s*\(result\) => !\("error" in result\),\s*\(\) => engine\.stopSync\(\{ deleteData: true \}\),?\s*\)/);
  assert.match(remote, /error instanceof HeldLoginsResetError/);
  assert.match(engine, /useBrowser\.subscribe\(/);
  assert.match(engine, /dropProfiles\(\[\.\.\.seen\]\.filter\(\(profile\) => !live\.has\(profile\)\)\)/);
  assert.match(remote, /const begins = enterPhraseBegins\(engine\.useSync\.getState\(\)\);/);
  assert.match(remote, /whileResettingHeldLogins\(\s*\(\) => engine\.enterRecoveryPhrase\(folder, text\),\s*\(result\) => begins && "ok" in result,\s*\(\) => engine\.stopSync\(\),?\s*\)/);
  assert.doesNotMatch(remote, /clearHeldLogins|\.clear\(\)/);
});

test("the shared sync scopes name this device with the Linux host's device name, never This Mac", async () => {
  const host = fakeHost((method) => (method === "ArdiaSync.deviceName" ? "tux-desktop" : null));
  globalThis.acTestNativeModules = { ...globalThis.acTestNativeModules, ArdiaSync: { deviceName: resolveHostModule(host, "ArdiaSync", "deviceName") } };
  const { deviceName } = await import("../../browser/src/state/sync/scopeAdapters.ts");
  assert.equal(await loadSyncDeviceName(host), "tux-desktop");
  assert.equal(deviceName(), "tux-desktop");
  assert.equal(syncDeviceName(), deviceName(), "the Linux sync engine and the shared scopes agree on the name");
});
