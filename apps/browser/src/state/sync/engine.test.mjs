import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
let onWrite = null;
let readFails = false;
const knownAtRead = [];
let ids = 0;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `dev${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      onWrite?.(JSON.parse(payload));
      return id;
    },
    read: async (_folder, scope, known) => {
      knownAtRead.push([...known]);
      if (readFails) throw Object.assign(new Error("The sync folder couldn't be read"), { code: "ERR_SYNC_FOLDER_UNREADABLE" });
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
const S = () => useBrowser.getState();
const reset = () => (S().hydrate({}), useBrowser.setState({ bookmarksReady: { "": true } }));

test("a crash after a batch lands: after the restart it's sent again as it was, and the next batch gets a new seq", async () => {
  reset();
  const first = await import("./engine.ts?first");
  first.startSync();
  assert.ok("ok" in (await first.turnOnSync("/sync")));
  S().addBookmark({ profileId: "default", url: "https://one.example/", title: "One" });
  await first.syncNow();

  let disk = null;
  onWrite = (file) => {
    if (!disk && file.ops?.some((op) => op.v?.t === "Two")) disk = new Map(shell.docs);
  };
  S().addBookmark({ profileId: "default", url: "https://two.example/", title: "Two" });
  await first.syncNow();
  onWrite = null;
  assert.ok(disk);
  shell.docs.clear();
  for (const [name, contents] of disk) shell.docs.set(name, contents);

  const second = await import("./engine.ts?second");
  second.startSync();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  S().addBookmark({ profileId: "default", url: "https://three.example/", title: "Three" });
  await second.syncNow();

  const batches = new Map();
  for (const { scope, payload } of folder.values()) {
    const file = JSON.parse(payload);
    if (file.kind !== "log") continue;
    const key = `${scope} ${file.device} ${file.seq}`;
    assert.equal(batches.get(key) ?? payload, payload, `${key} was published twice with different changes`);
    batches.set(key, payload);
  }
  const three = [...folder.values()].map((f) => JSON.parse(f.payload)).find((f) => f.ops?.some((op) => op.v?.t === "Three"));
  assert.deepEqual(three.ops.map((op) => op.v?.t), ["Three"], "only what's new");
  assert.ok(shell.docs.has("sync-journal-1.nns"), "the journal keeps the batches the saved state doesn't have yet");
});

test("a cycle writes its batch as a small journal file and leaves the saved state alone", async () => {
  reset();
  const engine = await import("./engine.ts?parts");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  await engine.syncNow();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  const written = [];
  const set = shell.docs.set.bind(shell.docs);
  shell.docs.set = (name, contents) => (written.push(name), set(name, contents));
  try {
    for (const n of [1, 2, 3]) {
      S().addBookmark({ profileId: "default", url: `https://part${n}.example/`, title: `Part ${n}` });
      await engine.syncNow();
    }
  } finally {
    delete shell.docs.set;
  }
  assert.equal(written.filter((name) => name === "sync-state.nns").length, 0, "the whole state isn't rewritten every cycle");
  assert.ok(written.filter((name) => /^sync-journal-\d+\.nns$/.test(name)).length >= 3, "each batch lands in its own journal file");
});

test("a batch is published only once the journal holding it is on disk", async () => {
  reset();
  const engine = await import("./engine.ts?held");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  await engine.syncNow();
  const published = () => [...folder.values()].map((f) => JSON.parse(f.payload)).filter((f) => f.ops?.some((op) => op.v?.t === "Held"));

  shell.heldSaves.on = true;
  S().addBookmark({ profileId: "default", url: "https://held.example/", title: "Held" });
  const syncing = engine.syncNow();
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(published().length, 0, "nothing goes out while the journal save is still pending");
  assert.ok(shell.heldSaves.queue.length > 0, "the journal save is waiting");

  shell.heldSaves.on = false;
  for (const land of shell.heldSaves.queue.splice(0)) land();
  await syncing;
  assert.equal(published().length, 1, "published once the journal landed");
});

test("a sync folder that can't be read reads as offline and keeps every file it knew", async () => {
  reset();
  const engine = await import("./engine.ts?unreadable");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  S().addBookmark({ profileId: "default", url: "https://kept.example/", title: "Kept" });
  await engine.syncNow();
  readFails = true;
  try {
    await engine.syncNow();
    assert.equal(engine.useSync.getState().status, "offline");
  } finally {
    readFails = false;
  }
  knownAtRead.length = 0;
  await engine.syncNow();
  assert.equal(engine.useSync.getState().status, "updated");
  assert.ok(knownAtRead.flat().length > 0, "the next read still skips the files it had read");
});

test("a sent tab isn't opened while the Mac is quitting, so it can't land after the session froze", async () => {
  reset();
  const quit = await import("../app/quit.ts");
  const { deliverSentTabs } = await import("./sentTabs.ts");
  S().createWindow({ profileId: "default", url: "https://current.example/" });
  const send = { u: "https://sent.example/while-quitting", t: "", to: "me", from: "phone", at: Date.now() };
  const opened = () => Object.values(S().tabs).filter((t) => t.url === send.u).length;
  quit.setQuitting(true);
  try {
    assert.equal(deliverSentTabs({ scopes: {} }, "default", [{ key: "send:quit", send }]), false, "refused while quitting");
  } finally {
    quit.setQuitting(false);
  }
  assert.equal(opened(), 0);
  assert.equal(deliverSentTabs({ scopes: {} }, "default", [{ key: "send:quit", send }]), true);
  assert.equal(opened(), 1, "and opened once the quit is off");
});

test("a tab sent to this Mac opens once, behind the current tab of the window showing its profile, and the send is deleted", async () => {
  reset();
  const { Clock } = await import("@ardia/sync");
  const engine = await import("./engine.ts?receive");
  engine.startSync();
  assert.ok("ok" in (await engine.turnOnSync("/sync")));
  const windowId = S().createWindow({ profileId: "default", url: "https://current.example/" });
  const current = S().windows[windowId].activeTabIds.default;
  await engine.syncNow();
  const saved = JSON.parse(shell.docs.get("sync.json"));
  const me = saved.deviceId;
  const scope = `p:${saved.profiles.default.syncId}`;
  const phone = new Clock("phone");
  const log = (seq, ops) => JSON.stringify({ v: 1, kind: "log", device: "phone", seq, at: Date.now(), ops: ops.map(([k, v]) => ({ k, h: phone.tick(), v })) });
  folder.set("phone-app", { scope: "app", payload: log(1, [["dev:phone", { n: "iPhone", k: "phone", f: ["send"] }], ["dev:old", { n: "Old Mac" }]]) });
  folder.set("phone-p", { scope, payload: log(1, [["send:0b6f1c2e-6a39-4d0e-9f3a-2c1b7a5d8e41", { u: "https://sent.example/story", t: "A Story", to: me, from: "phone", at: Date.now() }]]) });
  const received = [];
  engine.onTabsReceived((tabs) => received.push(...tabs));
  await engine.syncNow();
  await engine.syncNow();

  const sent = Object.values(S().tabs).filter((t) => t.url === "https://sent.example/story");
  assert.equal(sent.length, 1, "opened once");
  assert.equal(sent[0].windowId, windowId);
  assert.equal(S().windows[windowId].activeTabIds.default, current, "the current tab stays in front");
  assert.deepEqual(received.map((r) => [r.tabId, r.from]), [[sent[0].id, { name: "iPhone", kind: "phone" }]]);
  const tombstones = [...folder.values()].filter((f) => f.scope === scope).map((f) => JSON.parse(f.payload)).filter((f) => f.device === me).flatMap((f) => f.ops).filter((op) => op.k.startsWith("send:"));
  assert.deepEqual(tombstones.map((op) => op.v), [null], "deleted by this Mac, once");

  const relaunched = await import("./engine.ts?receive-again");
  relaunched.startSync();
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  await relaunched.syncNow();
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://sent.example/story").length, 1, "not opened again after a relaunch");

  assert.deepEqual(relaunched.sendTargets("default"), [{ id: "phone", name: "iPhone", kind: "phone" }], "only devices that take sent tabs, never this Mac");
  assert.ok(relaunched.sendTab(current, "phone"));
  assert.ok(!relaunched.sendTab(current, "old"), "a device that can't take it");
  await relaunched.syncNow();
  const mine = [...folder.values()].map((f) => ({ scope: f.scope, file: JSON.parse(f.payload) })).filter(({ file }) => file.device === me);
  const out = mine.filter(({ scope: s }) => s === scope).flatMap(({ file }) => file.ops).filter((op) => op.k.startsWith("send:") && op.v);
  assert.equal(out.length, 1);
  assert.match(out[0].k, /^send:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual({ ...out[0].v, at: 0 }, { u: "https://current.example/", t: "", to: "phone", from: me, at: 0 });
  const device = mine.filter(({ scope: s }) => s === "app").flatMap(({ file }) => file.ops).find((op) => op.k === `dev:${me}`);
  assert.deepEqual(device.v, { n: "Test Mac", k: "mac", f: ["send"] });
});

test("a Keychain unlock that fails outright reads as stalled with its error instead of staying on starting", async () => {
  reset();
  shell.docs.clear();
  const first = await import("./engine.ts?unlock-setup");
  first.startSync();
  assert.ok("ok" in (await first.turnOnSync("/sync")));
  await first.syncNow();
  const native = globalThis.acTestNativeModules.ArdiaSync;
  const unlock = native.unlock;
  native.unlock = async () => {
    throw new Error("The Keychain couldn't be read");
  };
  try {
    const relaunched = await import("./engine.ts?unlock-fails");
    relaunched.startSync();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    const { status, error } = relaunched.useSync.getState();
    assert.equal(status, "stalled");
    assert.match(error ?? "", /Keychain couldn't be read/);
  } finally {
    native.unlock = unlock;
  }
});
