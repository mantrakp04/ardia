import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock } from "./hlc.ts";
import { syncScope } from "./scope.ts";
import { emptyScope, type Adapter, type Listing, type ScopeState, type Transport } from "./scopeState.ts";

const DAY = 86_400_000;

type Status = "whole" | "pending" | "damaged";
class Folder {
  files = new Map<string, { payload: string; status: Map<string, Status> }>();
  counter = 0;
  now = 1_000_000_000_000;
  transport(device: string): Transport {
    return {
      write: async (_scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { payload, status: new Map() });
        return id;
      },
      read: async (_scope, known): Promise<Listing> => {
        const listing: Listing = { files: [], pending: [], damaged: [], present: [] };
        for (const [id, file] of this.files) {
          listing.present.push(id);
          if (known.includes(id)) continue;
          const status = file.status.get(device) ?? "whole";
          if (status === "pending") listing.pending.push(id);
          else if (status === "damaged") listing.damaged.push({ id, age: 0 });
          else listing.files.push({ id, payload: file.payload });
        }
        return listing;
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Mac {
  store = new Map<string, unknown>();
  state: ScopeState = emptyScope();
  offset = 0;
  clock: Clock;
  readonly id: string;
  readonly folder: Folder;
  readonly adapter: (mac: Mac) => Adapter;
  constructor(id: string, folder: Folder, adapter: (mac: Mac) => Adapter) {
    this.id = id;
    this.folder = folder;
    this.adapter = adapter;
    this.clock = new Clock(id, null, () => this.time());
  }
  time() {
    return this.folder.now + this.offset;
  }
  sync() {
    return syncScope({ scope: "s", state: this.state, transport: this.folder.transport(this.id), adapters: [this.adapter(this)], clock: this.clock, device: this.id, now: () => this.time() });
  }
  relaunch() {
    this.state = JSON.parse(JSON.stringify(this.state)) as ScopeState;
    this.clock = new Clock(this.id, this.clock.last, () => this.time());
  }
}

const homes = (mac: Mac): Adapter => ({
  prefix: "ph:",
  publishAfterPull: true,
  extract: () => ({ values: new Map(mac.store) }),
  apply: (visible, changed) => {
    for (const k of changed) visible.has(k) ? mac.store.set(k, visible.get(k)) : mac.store.delete(k);
  },
});

const shares = (mac: Mac): Adapter => ({
  prefix: "sh:",
  publishAfterPull: true,
  extract: (_base, _queued, _now, known) => {
    const values = new Map([...mac.store].filter(([k]) => !known(k)));
    return { values, ignore: (k) => !values.has(k) };
  },
  apply: () => true,
});

async function oneFileFrom(other: Mac, mac: Mac) {
  other.store.set("ph:a", "theirs");
  await other.sync();
  const id = [...other.folder.files.keys()].at(-1)!;
  return { id, status: (s: Status) => other.folder.files.get(id)!.status.set(mac.id, s) };
}

test("a file pending for over a day and then damaged gets a day of its own before it's set aside", async () => {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, homes), new Mac("b", folder, homes)];
  const file = await oneFileFrom(a, b);
  file.status("pending");
  await b.sync();
  folder.now += 2 * DAY;
  await b.sync();
  file.status("damaged");
  await b.sync();
  assert.notEqual(b.state.files[file.id]?.k, "bad", "its download age doesn't count as damage");
  assert.ok(file.id in b.state.damaged);
  folder.now += DAY + 1;
  await b.sync();
  assert.equal(b.state.files[file.id]?.k, "bad", "a day after it was first damaged it's set aside");
});

test("a damaged file keeps its damage age while it's pending again", async () => {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, homes), new Mac("b", folder, homes)];
  const file = await oneFileFrom(a, b);
  file.status("damaged");
  await b.sync();
  folder.now += DAY / 2;
  file.status("pending");
  await b.sync();
  folder.now += DAY / 2 + 1;
  file.status("damaged");
  await b.sync();
  assert.equal(b.state.files[file.id]?.k, "bad", "a day after it was first damaged, whatever happened in between");
});

test("a set-aside file isn't read again, and a file read whole leaves nothing in flight", async () => {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, homes), new Mac("b", folder, homes)];
  const bad = await oneFileFrom(a, b);
  bad.status("damaged");
  await b.sync();
  folder.now += DAY + 1;
  await b.sync();
  assert.equal(b.state.files[bad.id]?.k, "bad");
  bad.status("whole");
  await b.sync();
  assert.equal(b.store.get("ph:a"), undefined, "a set-aside file is known and not read again");
  a.store.set("ph:b", "late");
  await a.sync();
  const late = [...folder.files.keys()].at(-1)!;
  folder.files.get(late)!.status.set("b", "pending");
  await b.sync();
  assert.equal(b.state.pending, 1);
  folder.files.get(late)!.status.set("b", "whole");
  await b.sync();
  assert.deepEqual([b.state.pending, b.state.pendingSince, Object.keys(b.state.damaged)], [0, undefined, []]);
  assert.equal(b.store.get("ph:b"), "late");
});

test("a Mac back on a saved state doesn't publish an only-if-absent record before it has pulled", async () => {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, shares), new Mac("b", folder, shares)];
  await b.sync();
  b.relaunch();
  a.store.set("sh:x", "a's");
  await a.sync();
  b.store.set("sh:x", "b's");
  folder.now += 1000;
  await b.sync();
  const published = [...folder.files.values()].map((f) => JSON.parse(f.payload) as { device: string; ops?: { k: string }[] });
  assert.ok(!published.some((f) => f.device === "b" && f.ops?.some((op) => op.k === "sh:x")), "b never writes over a's record");
});

async function homesAgreed() {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, homes), new Mac("b", folder, homes)];
  a.store.set("ph:k", "first");
  await a.sync();
  await b.sync();
  await a.sync();
  assert.equal(b.store.get("ph:k"), "first");
  b.offset = 60_000;
  folder.now += 10_000;
  return { folder, a, b };
}

test("a waiting adapter's edit made before a newer edit from another Mac still loses to it", async () => {
  const { folder, a, b } = await homesAgreed();
  a.store.set("ph:k", "a's edit");
  b.store.set("ph:k", "b's later edit");
  await b.sync();
  await a.sync();
  await b.sync();
  assert.equal(a.store.get("ph:k"), "b's later edit");
  assert.equal(b.store.get("ph:k"), "b's later edit");
  assert.ok(folder.files.size > 0);
});

test("a waiting adapter's deletion made before a newer edit from another Mac loses to the edit", async () => {
  const { a, b } = await homesAgreed();
  a.store.delete("ph:k");
  b.store.set("ph:k", "b's later edit");
  await b.sync();
  await a.sync();
  await b.sync();
  assert.equal(a.store.get("ph:k"), "b's later edit");
  assert.equal(b.store.get("ph:k"), "b's later edit");
});

test("a waiting adapter publishes nothing while this cycle's pull finds a file in flight, then publishes", async () => {
  const folder = new Folder();
  const [a, b] = [new Mac("a", folder, homes), new Mac("b", folder, homes)];
  const file = await oneFileFrom(a, b);
  file.status("pending");
  b.store.set("ph:mine", "held");
  await b.sync();
  assert.ok(!("ph:mine" in b.state.records), "held while a download is pending");
  file.status("whole");
  await b.sync();
  assert.ok("ph:mine" in b.state.records, "published once nothing is in flight");
});
