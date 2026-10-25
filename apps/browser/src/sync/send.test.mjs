import assert from "node:assert/strict";
import { test } from "node:test";
const { Clock, emptyScope, syncScope, compact } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 25, 12);

class Folder {
  files = new Map();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const here = [...this.files].filter(([, f]) => f.scope === scope);
        return { files: here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload })), pending: [], damaged: [], present: here.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
  ops(key) {
    return [...this.files.values()].flatMap((f) => {
      const file = JSON.parse(f.payload);
      return file.kind === "log" ? file.ops.filter((op) => op.k === key).map((op) => ({ ...op, device: file.device })) : [];
    });
  }
}

class Device {
  constructor(id, folder, { legacy = false, now } = {}) {
    this.id = id;
    this.folder = folder;
    this.legacy = legacy;
    this.now = now;
    this.state = emptyScope();
    this.clock = new Clock(id);
    this.ledger = { outgoing: {}, received: {} };
    this.delivered = [];
    this.refuse = false;
  }
  adapterList() {
    if (this.legacy) return [adapters.deviceTabsAdapter("default", this.id, () => this.id, true)];
    return [
      adapters.sentTabsAdapter(this.id, () => this.ledger, (sends) => {
        if (this.refuse) return false;
        for (const { key } of sends) assert.ok(!(key in this.ledger.received), "opened before it's marked as received");
        this.delivered.push(...sends);
        return true;
      }),
    ];
  }
  send(to, url, title = "Page") {
    const key = `send:${crypto.randomUUID()}`;
    this.ledger.outgoing[key] = { u: url, t: title, to, from: this.id, at: this.now() };
    return key;
  }
  async sync() {
    await syncScope({ scope: "p", state: this.state, transport: this.folder.transport(), adapters: this.adapterList(), clock: this.clock, device: this.id, now: this.now });
  }
  record(key) {
    return this.state.records[key];
  }
}

const timeline = () => {
  const t = { at: START };
  t.now = () => t.at;
  return t;
};

test("a send addressed to another device is never touched by a Mac that only passes it along", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const mac = new Device("A", folder, { now: time.now });
  const key = phone.send("B", "https://example.com/for-b");
  await phone.sync();
  for (let i = 0; i < 6; i++) {
    await mac.sync();
    time.at += DAY / 2;
  }
  assert.deepEqual(mac.delivered, [], "not this Mac's tab");
  assert.deepEqual(folder.ops(key).map((op) => op.device), ["P"], "only its sender ever wrote it");
  assert.deepEqual(mac.record(key), phone.record(key), "the same record, untouched");
});

test("a send opens once on its receiver, which then deletes it, and the sender stops publishing it", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const mac = new Device("A", folder, { now: time.now });
  const key = phone.send("A", "https://example.com/article", "An Article");
  await phone.sync();
  for (let i = 0; i < 4; i++) {
    await mac.sync();
    await phone.sync();
    time.at += 60_000;
  }
  assert.deepEqual(mac.delivered.map((d) => [d.key, d.send.u, d.send.t]), [[key, "https://example.com/article", "An Article"]]);
  assert.equal(mac.record(key).v, null, "the receiver deleted it");
  assert.equal(phone.record(key).v, null, "and the sender has the deletion");
  assert.deepEqual(folder.ops(key).map((op) => [op.device, op.v === null]), [["P", false], ["A", true]], "one write each, no echo");
  assert.deepEqual(phone.ledger.outgoing, {}, "the sender no longer holds it");
  assert.deepEqual(mac.ledger.received, {}, "nor the receiver, once its deletion is out");
});

test("a send whose receiver doesn't come back within 7 days is dropped by its sender and never opens", async () => {
  const folder = new Folder();
  const time = timeline();
  const mac = new Device("A", folder, { now: time.now });
  const away = new Device("B", folder, { now: time.now });
  const key = mac.send("B", "https://example.com/late");
  await mac.sync();
  time.at += 6 * DAY;
  await mac.sync();
  assert.notEqual(mac.record(key).v, null, "kept for a week");
  time.at += DAY;
  await mac.sync();
  assert.equal(mac.record(key).v, null, "dropped after 7 days");
  await away.sync();
  assert.deepEqual(away.delivered, [], "a send its sender dropped never opens");
});

test("a send queued before the 7 days are up but never published is dropped without a write", async () => {
  const folder = new Folder();
  const time = timeline();
  const mac = new Device("A", folder, { now: time.now });
  mac.send("B", "https://example.com/stale");
  time.at += 8 * DAY;
  await mac.sync();
  assert.equal(folder.files.size, 0);
  assert.deepEqual(mac.ledger.outgoing, {});
});

test("a send that can't be opened yet stays until it can, and isn't deleted meanwhile", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const mac = new Device("A", folder, { now: time.now });
  const key = phone.send("A", "https://example.com/wait");
  await phone.sync();
  mac.refuse = true;
  await mac.sync();
  await mac.sync();
  assert.notEqual(mac.record(key).v, null, "kept while it couldn't open");
  mac.refuse = false;
  await mac.sync();
  await mac.sync();
  assert.deepEqual(mac.delivered.map((d) => d.key), [key]);
  assert.equal(mac.record(key).v, null);
});

test("a crash after a send opened but before anything was saved opens it again rather than losing it; a saved ledger opens it once", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const mac = new Device("A", folder, { now: time.now });
  const key = phone.send("A", "https://example.com/crash");
  await phone.sync();
  const before = { state: structuredClone(mac.state), ledger: structuredClone(mac.ledger), clock: mac.clock.last };
  await mac.sync();
  assert.equal(mac.delivered.length, 1);

  const lost = new Device("A", folder, { now: time.now });
  lost.state = structuredClone(before.state);
  lost.ledger = structuredClone(before.ledger);
  await lost.sync();
  assert.deepEqual(lost.delivered.map((d) => d.key), [key], "nothing was saved: it opens again");

  const ledgerSaved = new Device("A", folder, { now: time.now });
  ledgerSaved.state = structuredClone(before.state);
  ledgerSaved.ledger = structuredClone(mac.ledger);
  await ledgerSaved.sync();
  await ledgerSaved.sync();
  assert.deepEqual(ledgerSaved.delivered, [], "the saved ledger knows it's open");
  assert.equal(ledgerSaved.record(key).v, null, "and still deletes it");
});

test("a sender that crashed after its send went out, with the send still queued, never sends it again over the receiver's deletion", async () => {
  const folder = new Folder();
  const time = timeline();
  const mac = new Device("A", folder, { now: time.now });
  const phone = new Device("P", folder, { now: time.now });
  const key = mac.send("P", "https://example.com/once");
  const queued = structuredClone(mac.ledger);
  await mac.sync();
  mac.ledger = queued;
  for (let i = 0; i < 3; i++) {
    await phone.sync();
    await mac.sync();
  }
  assert.deepEqual(phone.delivered.map((d) => d.key), [key]);
  assert.deepEqual(folder.ops(key).map((op) => [op.device, op.v === null]), [["A", false], ["P", true]], "the deletion stands");
  assert.deepEqual(mac.ledger.outgoing, {});
});

test("a Mac on an older version keeps send records in its replica and snapshots, and opens them once it updates", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const old = new Device("A", folder, { legacy: true, now: time.now });
  const forOld = phone.send("A", "https://example.com/for-the-old-mac");
  const forOther = phone.send("B", "https://example.com/for-another");
  await phone.sync();
  for (let i = 0; i < 3; i++) await old.sync();
  assert.deepEqual(folder.ops(forOld).map((op) => op.device), ["P"]);
  assert.deepEqual(folder.ops(forOther).map((op) => op.device), ["P"]);
  assert.ok(old.state.unapplied.includes(forOld), "held for an adapter that knows it");
  await compact(old.state, folder.transport(), "p", "A", time.now(), {}, true);
  const snapshot = [...folder.files.values()].map((f) => JSON.parse(f.payload)).find((f) => f.kind === "snapshot");
  assert.ok(snapshot.records[forOld]?.v && snapshot.records[forOther]?.v, "the snapshot carries both");

  old.legacy = false;
  await old.sync();
  await old.sync();
  assert.deepEqual(old.delivered.map((d) => d.key), [forOld], "the update opens its own send");
  assert.equal(old.record(forOld).v, null);
  assert.notEqual(old.record(forOther).v, null, "and leaves the other device's alone");
});

test("only http and https pages are opened; anything else addressed here is deleted unopened", async () => {
  const folder = new Folder();
  const time = timeline();
  const phone = new Device("P", folder, { now: time.now });
  const mac = new Device("A", folder, { now: time.now });
  const page = phone.send("A", "https://example.com/ok");
  const script = phone.send("A", "javascript:alert(1)");
  const local = phone.send("A", "file:///etc/hosts");
  await phone.sync();
  await mac.sync();
  await mac.sync();
  assert.deepEqual(mac.delivered.map((d) => d.key), [page]);
  for (const key of [page, script, local]) assert.equal(mac.record(key).v, null);
});

test("this Mac's device record says it's a Mac that takes sent tabs, and older records still read as Macs", () => {
  const extraction = adapters.deviceAdapter("A", () => "Luke’s MacBook Pro").extract();
  const record = extraction.values.get("dev:A");
  assert.deepEqual(record, { n: "Luke’s MacBook Pro", k: "mac", f: ["send"] });
  assert.equal(adapters.deviceKindOf({ n: "Old Mac" }), "mac");
  assert.equal(adapters.receivesTabs({ n: "Old Mac" }), false);
  assert.equal(adapters.deviceKindOf({ n: "iPhone", k: "phone", f: ["send"] }), "phone");
  assert.equal(adapters.receivesTabs({ n: "iPhone", k: "phone", f: ["send"] }), true);
});

test("a phone is offered as a send target only while it has synced in the last 30 days; Macs as before", () => {
  const phone = { n: "iPhone", k: "phone", f: ["send"] };
  const mac = { n: "MacBook Pro", k: "mac", f: ["send"] };
  const now = START + 60 * DAY;
  assert.equal(adapters.offersTabs(phone, now - 29 * DAY, now), true);
  assert.equal(adapters.offersTabs(phone, now - 31 * DAY, now), false);
  assert.equal(adapters.offersTabs(phone, null, now), false);
  assert.equal(adapters.offersTabs(mac, null, now), true);
  assert.equal(adapters.offersTabs({ n: "Old Mac" }, now, now), false);
});

test("a phone not seen for 30 days leaves the devices list and the Your Devices menu; a Mac stays", () => {
  const now = START + 60 * DAY;
  assert.equal(adapters.isCurrentDevice({ n: "iPhone", k: "phone" }, now - 29 * DAY, now), true);
  assert.equal(adapters.isCurrentDevice({ n: "iPhone", k: "phone" }, now - 31 * DAY, now), false);
  assert.equal(adapters.isCurrentDevice({ n: "iPhone", k: "phone" }, null, now), false);
  assert.equal(adapters.isCurrentDevice({ n: "Old Mac" }, null, now), true);
});
