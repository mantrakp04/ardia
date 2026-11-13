import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { Clock, compact, emptyScope, syncScope } = await import("@ardia/sync");
const { useBrowser } = await import("../browser/store.ts");
const { deviceKindOf, deviceLabel, deviceSymbol, isCurrentDevice } = await import("./devices.ts");
const { sendTargetsIn } = await import("./sentTabs.ts");
const { appAdapters } = await import("./scopeAdapters.ts");

const S = () => useBrowser.getState();
const DAY = 86_400_000;
const NOW = Date.now();

const record = (v, device = "x") => ({ h: new Clock(device, null, () => NOW).tick(), v, o: [device, 1] });

function scopeWith(records, seen = {}) {
  const scope = emptyScope();
  Object.assign(scope.records, records);
  Object.assign(scope.seen, seen);
  return scope;
}

test("a tablet is its own kind: an iPad's label and symbol, and it drops off after 30 quiet days like a phone", () => {
  assert.equal(deviceKindOf({ n: "iPad", k: "tablet" }), "tablet");
  assert.equal(deviceKindOf({ n: "iPhone", k: "phone" }), "phone");
  assert.equal(deviceKindOf({ n: "Watch", k: "watch" }), "mac");
  assert.equal(deviceKindOf({ n: "MacBook Pro" }), "mac");
  assert.equal(deviceLabel("tablet", "Ada’s iPad Pro"), "iPad");
  assert.equal(deviceSymbol("tablet", "Ada’s iPad Pro"), "ipad");
  assert.equal(deviceSymbol("phone", "iPhone"), "iphone");
  const tablet = { n: "iPad", k: "tablet", f: ["send"] };
  assert.equal(isCurrentDevice(tablet, NOW - DAY, NOW), true);
  assert.equal(isCurrentDevice(tablet, NOW - 31 * DAY, NOW), false);
  assert.equal(isCurrentDevice({ n: "iMac" }, null, NOW), true);
});

test("an iPad that takes sent tabs is offered in every profile, as an iPhone is, and a quiet Mac only where it wrote", () => {
  const doc = {
    enabled: true,
    deviceId: "me",
    profiles: { default: { syncId: "s1", enabled: true } },
    scopes: {
      app: scopeWith({
        "dev:me": record({ n: "This Mac", k: "mac", f: ["send"] }, "me"),
        "dev:ipad": record({ n: "iPad", k: "tablet", f: ["send"] }, "ipad"),
        "dev:mini": record({ n: "Mac mini", k: "mac", f: ["send"] }, "mini"),
      }, { ipad: NOW - DAY, mini: NOW - DAY }),
      "p:s1": scopeWith({}),
    },
  };
  assert.deepEqual(sendTargetsIn(doc, "default"), [{ id: "ipad", name: "iPad", kind: "tablet" }]);
});

test("the Mac's device record carries the order of its synced spaces, and only of those", () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const school = S().createProfile({ name: "School" });
  const local = S().createProfile({ name: "Only here" });
  S().reorderProfiles([school, work, local, "default"]);
  const doc = {
    deviceId: "me",
    types: {},
    profiles: { default: { syncId: "sD", enabled: true }, [work]: { syncId: "sW", enabled: true }, [school]: { syncId: "sS", enabled: false } },
    scopes: {},
  };
  const extract = () => appAdapters(doc, false).find((a) => a.prefix === "dev:").extract(() => undefined, () => false, NOW, () => false, () => undefined, () => undefined).values;
  assert.deepEqual(extract().get("dev:me"), { n: "This Mac", k: "mac", f: ["send"], o: ["sW", "sD"] });
  S().reorderProfiles(["default", work]);
  assert.deepEqual(extract().get("dev:me").o, ["sD", "sW"]);
  doc.profiles = {};
  assert.deepEqual(extract().get("dev:me"), { n: "This Mac", k: "mac", f: ["send"] });
});

const OLD_MAC_DEVICE_ADAPTER = (id) => ({
  prefix: "dev:",
  extract: () => ({ values: new Map([[`dev:${id}`, { n: "Old iMac" }]]), ignore: (key) => key !== `dev:${id}` }),
  apply: () => true,
});

test("a Mac on 0.2.38 keeps a newer Mac's order in its replica and snapshot and never writes over it", async () => {
  const files = new Map();
  let counter = 0;
  let now = NOW;
  const transport = {
    write: async (scope, payload) => {
      const id = `f${++counter}`;
      files.set(id, { scope, payload });
      return id;
    },
    read: async (scope, known) => {
      const here = [...files].filter(([, f]) => f.scope === scope);
      return { files: here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload })), pending: [], damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_scope, ids) => ids.forEach((id) => files.delete(id)),
  };
  const device = (id, adapters) => ({ id, state: emptyScope(), clock: new Clock(id, null, () => now), adapters });
  const sync = (d) => syncScope({ scope: "app", state: d.state, transport, adapters: d.adapters, clock: d.clock, device: d.id, now: () => now });
  const ordered = { n: "MacBook Pro", k: "mac", f: ["send"], o: ["sW", "sD"] };
  const fresh = device("new", [{ prefix: "dev:", extract: () => ({ values: new Map([["dev:new", ordered]]), ignore: (k) => k !== "dev:new" }), apply: () => true }]);
  const old = device("old", [OLD_MAC_DEVICE_ADAPTER("old")]);
  await sync(fresh);
  for (let i = 0; i < 3; i++) {
    now += 15_000;
    await sync(old);
  }
  assert.deepEqual(old.state.records["dev:new"].v, ordered);
  const oldOps = [...files.values()].map((f) => JSON.parse(f.payload)).filter((f) => f.kind === "log" && f.device === "old").flatMap((f) => f.ops.map((op) => op.k));
  assert.deepEqual([...new Set(oldOps)], ["dev:old"]);
  now += 2 * 3_600_000;
  await compact(old.state, transport, "app", old.id, now, {}, true);
  const snapshot = [...files.values()].map((f) => JSON.parse(f.payload)).find((f) => f.kind === "snapshot" && f.device === "old");
  assert.deepEqual(snapshot.records["dev:new"].v, ordered);
  const joiner = device("joiner", []);
  await sync(joiner);
  assert.deepEqual(joiner.state.records["dev:new"].v, ordered);
});

test("the Mac rewrites its device record only when the record changes, so a reorder is the newest stamp and idle cycles write nothing", async () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const doc = { deviceId: "me", types: {}, profiles: { default: { syncId: "sD", enabled: true }, [work]: { syncId: "sW", enabled: true } }, scopes: {} };
  const files = [];
  const transport = {
    write: async (scope, payload) => (files.push(JSON.parse(payload)), `f${files.length}`),
    read: async () => ({ files: [], pending: [], damaged: [], present: [] }),
    remove: async () => {},
  };
  let now = NOW;
  const state = emptyScope();
  const clock = new Clock("me", null, () => now);
  const cycle = async () => {
    now += 15_000;
    const adapters = appAdapters(doc, false).filter((a) => a.prefix === "dev:");
    await syncScope({ scope: "app", state, transport, adapters, clock, device: "me", now: () => now });
  };
  const writes = () => files.flatMap((f) => f.ops ?? []).filter((op) => op.k === "dev:me");
  for (let i = 0; i < 4; i++) await cycle();
  assert.equal(writes().length, 1, "idle cycles leave the record as it was");
  S().reorderProfiles([work, "default"]);
  await cycle();
  for (let i = 0; i < 3; i++) await cycle();
  assert.deepEqual(writes().map((op) => op.v.o), [["sD", "sW"], ["sW", "sD"]]);
  assert.ok(writes()[1].h > writes()[0].h, "the reorder carries the newer stamp");
});
