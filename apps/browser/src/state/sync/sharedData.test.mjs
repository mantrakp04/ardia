import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
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
const { sharingProfiles } = await import("../profiles/profiles.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { default: true } });
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

test("a profile that shares data on one Mac shares the same profile's data on the Mac that adds it from sync", async () => {
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?macA");
  const engineB = await import("./engine.ts?macB");

  const onA = await a.with(async () => {
    const work = S().createProfile({ name: "Work", shareWith: "default" });
    const home = S().createProfile({ name: "Home" });
    const kids = S().createProfile({ name: "Kids", shareWith: home });
    assert.deepEqual(sharingProfiles(S(), "default"), [work], "Personal and Work share on the first Mac");
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
    return { work, home, kids, links: { ...engineA.useSync.getState().profiles } };
  });

  for (const op of published("prof:")) assert.deepEqual(Object.keys(op.v).filter((k) => !["n", "c", "i", "d", "th"].includes(k)), [], "prof: records keep the shape older Macs publish");

  await b.with(async () => {
    S().createProfile({ name: "Home" });
    engineB.startSync();
    assert.ok("ok" in (await engineB.enterRecoveryPhrase("/sync", "words")));
    await engineB.syncNow();
    await engineB.syncNow();

    const remote = engineB.useSync.getState().remoteProfiles;
    const work = remote.find((p) => p.name === "Work");
    const kids = remote.find((p) => p.name === "Kids");
    assert.deepEqual(work?.sharesWith, { name: "Personal", added: false });
    assert.deepEqual(kids?.sharesWith, { name: "Home", added: false }, "Home paired by name, so Kids shares this Mac's Home");

    const workHere = engineB.addRemoteProfile(work.syncId);
    assert.ok(workHere);
    assert.equal(S().profiles[workHere].dataId, "default");
    assert.deepEqual(sharingProfiles(S(), "default"), [workHere], "Settings › Profiles › Personal shows Shared data on the second Mac");

    const homeHere = S().profileOrder.find((id) => S().profiles[id].name === "Home");
    assert.notEqual(homeHere, onA.home, "the owner's profile id differs per Mac");
    const kidsHere = engineB.addRemoteProfile(kids.syncId);
    assert.equal(S().profiles[kidsHere].dataId, homeHere, "the link resolves to this Mac's own profile for that owner");
  });
});

test("adding a profile whose owner isn't on this Mac adds the owner too, sharing its data", async () => {
  const a = new Mac("A");
  const c = new Mac("C");
  folder.clear();
  const engineA = await import("./engine.ts?macA2");
  const engineC = await import("./engine.ts?macC");

  await a.with(async () => {
    const school = S().createProfile({ name: "School" });
    S().createProfile({ name: "Homework", shareWith: school });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
  });

  await c.with(async () => {
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    const homework = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Homework");
    assert.deepEqual(homework?.sharesWith, { name: "School", added: true });
    const id = engineC.addRemoteProfile(homework.syncId);
    const school = S().profileOrder.find((p) => S().profiles[p].name === "School");
    assert.ok(school, "School was added with it");
    assert.equal(S().profiles[id].dataId, school);
    assert.deepEqual(sharingProfiles(S(), school), [id]);
    assert.equal(engineC.useSync.getState().remoteProfiles.length, 0, "both are on this Mac now");
    await engineC.syncNow();
  });

  const before = published("share:").length;
  await a.with(() => engineA.syncNow());
  await c.with(() => engineC.syncNow());
  await a.with(() => engineA.syncNow());
  assert.equal(published("share:").length, before, "the share: records settle: neither Mac republishes them");
});

const shareRecords = (engine) =>
  Object.fromEntries(
    Object.entries(engine.appScopeRecords())
      .filter(([k]) => k.startsWith("share:"))
      .map(([k, r]) => [k.slice(6), r.v?.o ?? null]),
  );

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

test("two Macs whose same-named profile shares different data settle instead of republishing forever", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?loopA");
  const engineB = await import("./engine.ts?loopB");
  await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  await join(b, engineB, () => {
    const home = S().createProfile({ name: "Home" });
    S().createProfile({ name: "Work", shareWith: home });
  });
  for (let i = 0; i < 3; i++) {
    await a.with(() => engineA.syncNow());
    await b.with(() => engineB.syncNow());
  }
  const before = published("share:").length;
  for (let i = 0; i < 4; i++) {
    await a.with(() => engineA.syncNow());
    await b.with(() => engineB.syncNow());
  }
  assert.equal(published("share:").length, before, "no Mac republishes share: once both have seen the other's record");
  await a.with(() => assert.equal(S().profiles[named("Work")].dataId, "default", "each Mac keeps its own data"));
});

test("share: records that form a cycle resolve the same way whichever profile a new Mac adds first", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const c = new Mac("C");
  const d = new Mac("D");
  const engineA = await import("./engine.ts?cycleA");
  const engineB = await import("./engine.ts?cycleB");
  const engineC = await import("./engine.ts?cycleC");
  const engineD = await import("./engine.ts?cycleD");
  await a.with(() => S().createProfile({ name: "Beta", shareWith: S().createProfile({ name: "Alpha" }) }));
  await turnOn(a, engineA);
  await join(b, engineB, () => S().createProfile({ name: "Alpha", shareWith: S().createProfile({ name: "Beta" }) }));
  await a.with(() => engineA.syncNow());
  await b.with(() => engineB.syncNow());

  const owners = await b.with(() => shareRecords(engineB));
  const links = await b.with(() => engineB.useSync.getState().profiles);
  const alpha = await b.with(() => links[named("Alpha")].syncId);
  const beta = await b.with(() => links[named("Beta")].syncId);
  assert.deepEqual([owners[alpha], owners[beta]], [beta, alpha], "the records form a cycle");
  const lowest = [alpha, beta].sort()[0];
  const ownerName = lowest === alpha ? "Alpha" : "Beta";
  const sharerName = lowest === alpha ? "Beta" : "Alpha";

  const outcome = async (mac, engine, first) => {
    await join(mac, engine);
    return mac.with(() => {
      for (const name of [first, first === "Alpha" ? "Beta" : "Alpha"]) {
        const remote = engine.useSync.getState().remoteProfiles.find((p) => p.name === name);
        if (remote) engine.addRemoteProfile(remote.syncId);
      }
      const owner = named(ownerName);
      const sharer = named(sharerName);
      assert.ok(owner && sharer, "both profiles are on the Mac");
      return { ownerData: S().profiles[owner].dataId ?? null, sharerData: S().profiles[sharer].dataId === owner };
    });
  };
  assert.deepEqual(await outcome(c, engineC, "Alpha"), { ownerData: null, sharerData: true });
  assert.deepEqual(await outcome(d, engineD, "Beta"), { ownerData: null, sharerData: true });
});

test("a profile that shares a deleted owner's data doesn't advertise sharing; one that shared before keeps its record", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?goneA");
  const engineC = await import("./engine.ts?goneC");
  const ids = await a.with(() => {
    const owner = S().createProfile({ name: "Owner" });
    return { owner, child: S().createProfile({ name: "Child", shareWith: owner }) };
  });
  await turnOn(a, engineA);
  await a.with(async () => {
    S().deleteProfile(ids.owner);
    S().createProfile({ name: "Another", shareWith: ids.child });
    await engineA.syncNow();
    await engineA.syncNow();
  });
  await join(c, engineC);
  await c.with(() => {
    const remote = engineC.useSync.getState().remoteProfiles;
    const another = remote.find((p) => p.name === "Another");
    assert.ok(another);
    assert.equal(another.sharesWith, undefined, "no Mac would sync that data group's data, so Another gets its own");
    assert.deepEqual(remote.find((p) => p.name === "Child")?.sharesWith, { name: "Owner", added: true }, "Child's record stays as it was written");
    const id = engineC.addRemoteProfile(another.syncId);
    assert.equal(S().profiles[id].dataId, undefined);
  });
});

test("a profile deleted and added back from sync shares its owner's data again", async () => {
  folder.clear();
  const a = new Mac("A");
  const engineA = await import("./engine.ts?readdA");
  const work = await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  await a.with(async () => {
    S().deleteProfile(work);
    await engineA.syncNow();
    await engineA.syncNow();
    const offered = engineA.useSync.getState().remoteProfiles.find((p) => p.name === "Work");
    assert.deepEqual(offered?.sharesWith, { name: "Personal", added: false }, "its share: record wasn't deleted with it");
    const again = engineA.addRemoteProfile(offered.syncId);
    assert.equal(S().profiles[again].dataId, "default");
  });
});

test("a profile whose owner hasn't synced here yet waits instead of getting data of its own", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?waitA");
  const engineC = await import("./engine.ts?waitC");
  await a.with(() => S().createProfile({ name: "Child", shareWith: S().createProfile({ name: "Owner" }) }));
  await turnOn(a, engineA);
  await join(c, engineC);
  await c.with(async () => {
    const records = engineC.appScopeRecords();
    const child = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Child");
    const ownerKey = `prof:${records[`share:${child.syncId}`].v.o}`;
    const ownerRecord = records[ownerKey];
    delete records[ownerKey];
    await engineC.syncNow();
    const waiting = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Child");
    assert.equal(waiting.waiting, true);
    const before = S().profileOrder.length;
    assert.equal(engineC.addRemoteProfile(child.syncId), null);
    assert.equal(S().profileOrder.length, before, "nothing is created while the chain is unresolved");
    records[ownerKey] = ownerRecord;
    await engineC.syncNow();
    const id = engineC.addRemoteProfile(child.syncId);
    assert.equal(S().profiles[id].dataId, named("Owner"));
  });
});

const scopeLevel = async () => {
  const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
  const shipped = await import("../../../../../packages/sync/src/fixtures/scope-v0.2.38.ts");
  const { sharedDataAdapter } = await import("./adapters.ts");
  const { profilesAdapter } = await import("./profileAdapters.ts");
  const files = new Map();
  const damaged = new Set();
  const pending = new Set();
  let wall = 1_900_000_000_000;
  const transport = {
    write: async (scope, payload) => {
      const id = `s${files.size + 1}`;
      files.set(id, { scope, payload });
      return id;
    },
    read: async (scope, known) => {
      const here = [...files].filter(([, f]) => f.scope === scope);
      const readable = here.filter(([id]) => !known.includes(id) && !damaged.has(id) && !pending.has(id));
      return {
        files: readable.map(([id, f]) => ({ id, payload: f.payload })),
        pending: [...pending],
        damaged: [...damaged].map((id) => ({ id, age: 0 })),
        present: [...here.map(([id]) => id), ...pending],
      };
    },
    remove: async (_scope, ids) => ids.forEach((id) => files.delete(id)),
  };
  const mac = (device, ownerName) => {
    S().hydrate({});
    const owner = ownerName ? S().createProfile({ name: ownerName }) : "default";
    const work = S().createProfile({ name: "Work", shareWith: owner });
    return { device, browser: S(), clock: new Clock(device, null, () => ++wall), links: { [owner]: { syncId: ownerName ? "sHome" : "sPersonal", enabled: true }, [work]: { syncId: "sWork", enabled: true } } };
  };
  const run = async (m, state, legacy = false) => {
    useBrowser.setState(m.browser, true);
    const sync = legacy ? shipped.syncScope : syncScope;
    const adapters = legacy ? [] : [sharedDataAdapter(() => m.links), profilesAdapter(() => m.links)];
    await sync({ scope: "app", state, transport, adapters, clock: m.clock, device: m.device, now: () => wall });
  };
  const batchesBy = (device) => [...files].filter(([id]) => !damaged.has(id)).map(([, f]) => JSON.parse(f.payload)).filter((f) => f.device === device);
  const sentBy = (device, prefix = "share:") => batchesBy(device).flatMap((f) => f.ops ?? []).filter((op) => op.k.startsWith(prefix));
  const lastFile = () => [...files.keys()].at(-1);
  const advance = (ms) => (wall += ms);
  return { emptyScope, run, mac, sentBy, batchesBy, damaged, pending, lastFile, advance };
};

test("share: a Mac back on an already-joined state from before the record existed doesn't write over it", async () => {
  const { emptyScope, run, mac, sentBy } = await scopeLevel();
  const a = mac("A");
  const stateA = emptyScope();
  await run(a, stateA);
  await run(a, stateA);
  assert.deepEqual(stateA.records["share:sWork"]?.v, { o: "sPersonal" });

  const b = mac("B", "Home");
  const restored = { ...emptyScope(), joined: true };
  await run(b, restored);
  await run(b, restored);
  assert.deepEqual(sentBy("B"), [], "B publishes nothing over the record it pulled");
  assert.deepEqual(restored.records["share:sWork"]?.v, { o: "sPersonal" });
  await run(a, stateA);
  assert.deepEqual(stateA.records["share:sWork"]?.v, { o: "sPersonal" });
});

test("share: a Mac that held the record unapplied on 0.2.38 doesn't write over it once it upgrades", async () => {
  const { emptyScope, run, mac, sentBy } = await scopeLevel();
  const a = mac("A");
  const stateA = emptyScope();
  await run(a, stateA);
  await run(a, stateA);

  const b = mac("B", "Home");
  const old = emptyScope();
  await run(b, old, true);
  await run(b, old, true);
  assert.ok("share:sWork" in old.records && old.base["share:sWork"] === undefined, "0.2.38 keeps the record without a base");
  const upgraded = structuredClone(old);
  await run(b, upgraded);
  await run(b, upgraded);
  assert.deepEqual(sentBy("B"), []);
  assert.deepEqual(upgraded.records["share:sWork"]?.v, { o: "sPersonal" });
});

test("share: a Mac back on an older state waits while the file with the record is damaged, until it's read or given up", async () => {
  const { emptyScope, run, mac, sentBy, damaged, lastFile, advance } = await scopeLevel();
  const a = mac("A");
  const stateA = emptyScope();
  await run(a, stateA);
  await run(a, stateA);
  const withRecord = lastFile();
  damaged.add(withRecord);

  const b = mac("B", "Home");
  const restored = { ...emptyScope(), joined: true };
  await run(b, restored);
  await run(b, restored);
  assert.deepEqual(sentBy("B"), [], "nothing over a record that may be in the damaged file");
  damaged.delete(withRecord);
  await run(b, restored);
  assert.deepEqual(sentBy("B"), []);
  assert.deepEqual(restored.records["share:sWork"]?.v, { o: "sPersonal" }, "the record arrives once the file is readable");

  const c = mac("C", "Home");
  const lost = { ...emptyScope(), joined: true };
  damaged.add(withRecord);
  await run(c, lost);
  advance(86_400_001);
  await run(c, lost);
  await run(c, lost);
  assert.equal(sentBy("C").length, 1, "once the damaged file is given up, as the scope's policy says, it publishes its own");
});

test("a profile that shares data publishes prof: and share: together, so no Mac sees it without its sharing", async () => {
  const { emptyScope, run, mac, sentBy, batchesBy, pending } = await scopeLevel();
  const a = mac("A");
  const state = emptyScope();
  pending.add("stuck-download");
  await run(a, state);
  await run(a, state);
  await run(a, state);
  assert.deepEqual(sentBy("A", "prof:").map((op) => op.k), ["prof:sPersonal"], "Work waits with its share:");
  assert.deepEqual(sentBy("A"), []);
  pending.delete("stuck-download");
  await run(a, state);
  const batch = batchesBy("A").find((f) => f.ops?.some((op) => op.k === "prof:sWork"));
  assert.ok(batch?.ops.some((op) => op.k === "share:sWork" && op.v?.o === "sPersonal"), "prof:Work and share:Work go out in one batch");
});

test("a download that never finishes holds a sharing profile back for a day, then no longer", async () => {
  const { emptyScope, run, mac, sentBy, batchesBy, pending, advance } = await scopeLevel();
  const a = mac("A");
  const state = emptyScope();
  pending.add("never-current");
  await run(a, state);
  await run(a, state);
  advance(86_400_000 - 1_000);
  await run(a, state);
  assert.deepEqual(sentBy("A"), [], "within the day it waits for the download");
  assert.ok(!sentBy("A", "prof:").some((op) => op.k === "prof:sWork"));
  advance(2_000);
  await run(a, state);
  assert.ok(state.pendingSince?.["never-current"], "the download is still pending");
  const batch = batchesBy("A").find((f) => f.ops?.some((op) => op.k === "prof:sWork"));
  assert.ok(batch?.ops.some((op) => op.k === "share:sWork" && op.v?.o === "sPersonal"), "after the day both go out, in one batch");
  pending.delete("never-current");
});

test("a pending or damaged file first seen while the clock ran ahead still stops counting a day after now", async () => {
  const { emptyScope, run, mac, sentBy, pending, damaged, advance, lastFile } = await scopeLevel();
  const MONTH = 30 * 86_400_000;
  const a = mac("A");
  const state = emptyScope();
  await run(a, state);
  pending.add("never-current");
  state.pendingSince = { "never-current": advance(0) + MONTH };
  await run(a, state);
  assert.ok(state.pendingSince["never-current"] <= advance(0), "a first-seen time in the future is brought back to now");
  advance(86_400_001);
  await run(a, state);
  await run(a, state);
  assert.ok(sentBy("A").some((op) => op.k === "share:sWork"), "a day after now, not a month and a day");
  pending.delete("never-current");

  const b = mac("B", "Home");
  const restored = { ...emptyScope(), joined: true };
  const file = lastFile();
  damaged.add(file);
  restored.damaged = { [file]: advance(0) + MONTH };
  await run(b, restored);
  advance(86_400_001);
  await run(b, restored);
  assert.equal(restored.damaged[file], undefined, "the damaged file is given up a day after now");
  damaged.delete(file);
});
