import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extensionApprovalKey,
  extensionKey,
  extensionsAdapter,
  type ExtensionChange,
  type ExtensionIntent,
  type ExtensionsAdapter,
  type LocalExtension,
} from "./extensions.ts";
import { Clock } from "./hlc.ts";
import { compact, syncScope, visible } from "./scope.ts";
import { emptyScope, type Adapter, type Listing, type ScopeState, type Transport } from "./scopeState.ts";

const E1 = "a".repeat(32);
const E2 = "b".repeat(32);
const E3 = "c".repeat(32);

type StoreEntry = { version: string; fingerprint: string };

class Folder {
  files = new Map<string, string>();
  counter = 0;
  now = 1_000_000;
  store = new Map<string, StoreEntry>([
    [E1, { version: "1.0", fingerprint: "tabs" }],
    [E2, { version: "2.0", fingerprint: "storage" }],
    [E3, { version: "3.0", fingerprint: "all-hosts" }],
  ]);
  transport(): Transport {
    return {
      write: async (_scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, payload);
        return id;
      },
      read: async (_scope, known): Promise<Listing> => ({
        files: [...this.files].filter(([id]) => !known.includes(id)).map(([id, payload]) => ({ id, payload })),
        pending: [],
        damaged: [],
        present: [...this.files.keys()],
      }),
      remove: async (_scope, ids) => {
        for (const id of ids) this.files.delete(id);
      },
    };
  }
}

type Installed = LocalExtension & { version: string; fingerprint: string };

class Chrome {
  installed = new Map<string, Installed>();
  pending = new Map<string, ExtensionChange & { kind: "install" }>();
  intents: Record<string, ExtensionIntent> = {};
  generation = 0;
  changes: ExtensionChange[] = [];
  ready = true;
  settling: string[] = [];
  queued: string[] = [];
  failing = false;
  readonly folder: Folder;
  constructor(folder: Folder) {
    this.folder = folder;
  }
  userInstall(id: string, extra: Partial<Installed> = {}) {
    const s = this.folder.store.get(id)!;
    this.installed.set(id, { id, syncable: true, version: s.version, fingerprint: s.fingerprint, approved: true, userDisabled: false, incognito: false, pinned: false, ...extra });
    this.intents[id] = { kind: "installed", g: ++this.generation };
  }
  userUninstall(id: string) {
    this.installed.delete(id);
    this.intents[id] = { kind: "uninstalled", g: ++this.generation };
  }
  finishInstalls() {
    for (const [id, change] of this.pending) {
      const s = this.folder.store.get(id)!;
      const matches = !!change.approval && change.approval.v === s.version && change.approval.fps.includes(s.fingerprint);
      this.installed.set(id, {
        id,
        syncable: true,
        version: s.version,
        fingerprint: s.fingerprint,
        approved: matches,
        userDisabled: !change.record.on,
        incognito: change.record.inc,
        pinned: change.record.pin,
      });
    }
    this.pending.clear();
  }
  host() {
    return {
      read: async () => ({ ready: this.ready, extensions: [...this.installed.values()].map((e) => ({ ...e })), pending: [...this.pending.keys()], settling: [...this.settling], queued: [...this.queued] }),
      change: async (change: ExtensionChange) => {
        this.changes.push(change);
        if (this.failing) return false;
        if (change.kind === "cancel") {
          this.pending.delete(change.id);
          this.queued = this.queued.filter((id) => id !== change.id);
        } else if (change.kind === "install") {
          this.pending.set(change.id, change);
        } else {
          const e = this.installed.get(change.id)!;
          const grant = !!change.approval && change.approval.v === e.version && change.approval.fps.includes(e.fingerprint);
          this.installed.set(change.id, { ...e, userDisabled: !change.record.on, incognito: change.record.inc, pinned: change.record.pin, approved: e.approved || grant });
        }
        return true;
      },
      intents: () => ({ ...this.intents }),
      settleIntents: (published: Record<string, number>) => {
        for (const [id, g] of Object.entries(published)) if (this.intents[id]?.g === g) delete this.intents[id];
      },
      keepInstalled: (id: string) => {
        this.intents[id] = { kind: "installed", g: ++this.generation };
      },
    };
  }
}

class Mac {
  state: ScopeState = emptyScope();
  clock: Clock;
  chrome: Chrome;
  adapter: ExtensionsAdapter;
  legacy = false;
  readonly id: string;
  readonly folder: Folder;
  constructor(id: string, folder: Folder, { joining = false } = {}) {
    this.id = id;
    this.folder = folder;
    this.clock = new Clock(id, null, () => folder.now);
    this.chrome = new Chrome(folder);
    this.adapter = extensionsAdapter(this.chrome.host());
    if (joining) this.state.awaitRemote = true;
    else this.state.joined = true;
  }
  adapters(): Adapter[] {
    const other: Adapter = { prefix: "x:", extract: () => ({ values: new Map([[`x:${this.id}`, 1]]), ignore: (k) => k !== `x:${this.id}` }), apply: () => true };
    return this.legacy ? [other] : [this.adapter, other];
  }
  async sync() {
    this.folder.now += 10;
    await syncScope({ scope: "p", state: this.state, transport: this.folder.transport(), adapters: this.adapters(), clock: this.clock, device: this.id, now: () => this.folder.now });
    if (!this.legacy) await this.adapter.reconcile(visible(this.state, "ext:"), this.folder.now);
    this.chrome.finishInstalls();
  }
  ids() {
    return [...this.chrome.installed.keys()].sort();
  }
}

async function rounds(macs: Mac[], n = 3) {
  for (let i = 0; i < n; i++) for (const m of macs) await m.sync();
}

test("an extension installed on one Mac installs on the other with its state, and its approval", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1, { userDisabled: true, pinned: true, incognito: true });
  await rounds([a, b]);
  const e = b.chrome.installed.get(E1)!;
  assert.deepEqual([e.userDisabled, e.pinned, e.incognito, e.approved], [true, true, true, true]);
  const install = b.chrome.changes.find((c) => c.kind === "install")!;
  assert.deepEqual(install.kind === "install" && install.approval, { v: "1.0", fps: ["tabs"] });
  const seq = [a.state.seq, b.state.seq];
  await rounds([a, b]);
  assert.deepEqual([a.state.seq, b.state.seq], seq, "nothing echoes back");
});

test("enable, disable, incognito and pin follow; the later edit wins", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  a.chrome.installed.get(E1)!.userDisabled = true;
  await rounds([a, b]);
  assert.equal(b.chrome.installed.get(E1)!.userDisabled, true);
  b.chrome.installed.get(E1)!.userDisabled = false;
  b.chrome.installed.get(E1)!.pinned = true;
  await rounds([b, a]);
  assert.deepEqual([a.chrome.installed.get(E1)!.userDisabled, a.chrome.installed.get(E1)!.pinned], [false, true]);
  a.chrome.installed.get(E1)!.incognito = true;
  folder.now += 100;
  b.chrome.installed.get(E1)!.incognito = false;
  b.chrome.installed.get(E1)!.pinned = false;
  await rounds([a, b, a]);
  assert.deepEqual(a.chrome.installed.get(E1), b.chrome.installed.get(E1));
  assert.equal(a.chrome.installed.get(E1)!.pinned, false);
});

test("a removal is a live record: other Macs keep their copy but never install it again, and a reinstall wins", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  const c = new Mac("devC", folder, { joining: true });
  a.chrome.userInstall(E1);
  a.chrome.userInstall(E2);
  await rounds([a, b]);
  assert.deepEqual(b.ids(), [E1, E2]);
  b.chrome.userUninstall(E1);
  await rounds([b, a]);
  assert.deepEqual(a.ids(), [E1, E2], "sync never uninstalls");
  assert.deepEqual(a.state.records[extensionKey(E1)]!.v, { removed: true });
  assert.deepEqual(b.chrome.intents, {}, "the intent settles once published");
  await rounds([a, b, c], 4);
  assert.deepEqual([a.ids(), b.ids(), c.ids()], [[E1, E2], [E2], [E2]]);
  assert.deepEqual(a.state.records[extensionKey(E1)]!.v, { removed: true }, "A's copy doesn't put it back");
  a.chrome.installed.get(E1)!.pinned = true;
  await rounds([a, b]);
  assert.deepEqual(b.ids(), [E2], "nor does an edit to it");
  a.chrome.userUninstall(E1);
  a.chrome.userInstall(E1);
  await rounds([a, b, c]);
  assert.deepEqual([b.ids(), c.ids()], [[E1, E2], [E1, E2]], "installing it again wins");
});

test("an uninstall and reinstall before the first publish lands keeps the reinstall", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  a.chrome.userUninstall(E1);
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  assert.deepEqual([a.ids(), b.ids()], [[E1], [E1]]);
});

test("turning sync on merges both Macs' extensions (union)", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  b.chrome.userInstall(E2, { pinned: true });
  b.chrome.intents = {};
  await rounds([a, b, a]);
  assert.deepEqual([a.ids(), b.ids()], [[E1, E2], [E1, E2]]);
  assert.equal(a.chrome.installed.get(E2)!.pinned, true);
});

test("a joining Mac with the same extension takes the synced state, not its own defaults", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1, { pinned: true, userDisabled: true });
  await a.sync();
  b.chrome.userInstall(E1);
  b.chrome.intents = {};
  await rounds([b, a]);
  assert.deepEqual([b.chrome.installed.get(E1)!.pinned, b.chrome.installed.get(E1)!.userDisabled], [true, true]);
});

test("a newer store version than the approved one installs without the grant, and approval doesn't regress", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E3);
  await a.sync();
  folder.store.set(E3, { version: "3.1", fingerprint: "all-hosts,downloads" });
  await rounds([b, a]);
  assert.equal(b.chrome.installed.get(E3)!.approved, false);
  assert.deepEqual(a.state.records[extensionApprovalKey(E3)]!.v, { v: "3.0", fps: ["all-hosts"] });
  b.chrome.installed.get(E3)!.approved = true;
  await rounds([b, a]);
  assert.deepEqual(a.state.records[extensionApprovalKey(E3)]!.v, { v: "3.1", fps: ["all-hosts,downloads"] });
});

test("the same version with other permissions isn't granted", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E3);
  await a.sync();
  folder.store.set(E3, { version: "3.0", fingerprint: "all-hosts,history" });
  await rounds([b, a]);
  assert.equal(b.chrome.installed.get(E3)!.approved, false);
});

test("a Mac that already has the approved version, disabled for permissions, gets the grant", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  b.chrome.userInstall(E3, { approved: false });
  b.chrome.intents = {};
  await b.sync();
  a.chrome.userInstall(E3);
  await rounds([a, b]);
  assert.equal(b.chrome.installed.get(E3)!.approved, true);
});

test("a missing or null record never removes anything, and an ineligible extension is never published or removed", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  a.state.records[extensionKey(E1)] = { h: a.clock.tick(), v: null, o: ["devA", a.state.seq + 1] };
  a.state.outbox.push({ k: extensionKey(E1), h: a.state.records[extensionKey(E1)]!.h, v: null });
  await rounds([a, b]);
  assert.deepEqual(b.ids(), [E1]);
  b.chrome.installed.set(E2, { id: E2, syncable: false, version: "2.0", fingerprint: "storage" });
  await rounds([b, a]);
  assert.equal(extensionKey(E2) in a.state.records, false);
  b.chrome.installed.get(E1)!.syncable = false;
  await rounds([b, a]);
  assert.deepEqual(a.ids(), [E1]);
});

test("nothing is published or applied before Chrome's extension system is ready", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  a.chrome.userInstall(E1);
  a.chrome.ready = false;
  await a.sync();
  assert.equal(extensionKey(E1) in a.state.records, false);
  a.chrome.ready = true;
  await a.sync();
  assert.equal(extensionKey(E1) in a.state.records, true);
});

test("a pending install lost at a restart is retried, at most hourly", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await a.sync();
  b.chrome.finishInstalls = () => {};
  await b.sync();
  await b.sync();
  assert.equal(b.chrome.pending.has(E1), true);
  b.chrome.pending.clear();
  b.adapter = extensionsAdapter(b.chrome.host());
  await b.sync();
  assert.equal(b.chrome.pending.has(E1), true, "a new session retries at once");
  b.chrome.pending.clear();
  await b.sync();
  assert.equal(b.chrome.pending.has(E1), false, "not again within the hour");
  folder.now += 3_600_000;
  await b.sync();
  assert.equal(b.chrome.pending.has(E1), true);
});

test("a change made while an install is pending reaches the install", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await a.sync();
  const finish = b.chrome.finishInstalls.bind(b.chrome);
  b.chrome.finishInstalls = () => {};
  await b.sync();
  a.chrome.installed.get(E1)!.pinned = true;
  await a.sync();
  await b.sync();
  finish();
  assert.equal(b.chrome.installed.get(E1)!.pinned, true);
});

test("a removal reaching a pending install cancels it", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await a.sync();
  const finish = b.chrome.finishInstalls.bind(b.chrome);
  b.chrome.finishInstalls = () => {};
  await b.sync();
  a.chrome.userUninstall(E1);
  await a.sync();
  await b.sync();
  finish();
  assert.deepEqual(b.ids(), []);
});

test("an older Mac keeps the extension records, through its snapshots, for a Mac that joins later", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const old = new Mac("devOld", folder, { joining: true });
  old.legacy = true;
  a.chrome.userInstall(E1);
  a.chrome.userInstall(E2);
  await rounds([a, old]);
  a.chrome.userUninstall(E2);
  await rounds([a, old]);
  assert.deepEqual(old.state.records[extensionKey(E2)]!.v, { removed: true });
  assert.ok(old.state.unapplied.includes(extensionKey(E1)));
  folder.now += 100 * 86_400_000;
  await compact(old.state, folder.transport(), "p", old.id, folder.now, { pruneGrace: 0 }, true);
  await compact(old.state, folder.transport(), "p", old.id, folder.now, { pruneGrace: 0 }, true);
  const snapshots = [...folder.files.values()].filter((f) => f.includes('"snapshot"'));
  assert.ok(snapshots.length > 0);
  const c = new Mac("devC", folder, { joining: true });
  c.chrome.userInstall(E2);
  c.chrome.intents = {};
  await rounds([c]);
  assert.deepEqual(c.ids(), [E1, E2], "a joining Mac keeps what it has; the old removal isn't applied to it");
  assert.deepEqual(c.state.records[extensionKey(E2)]!.v, { on: true, inc: false, pin: false }, "and publishes it (union)");
});

test("an upgraded Mac holding a removal it hadn't applied doesn't republish its copy", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  b.legacy = true;
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  b.chrome.installed.set(E1, { id: E1, syncable: true, version: "1.0", fingerprint: "tabs", approved: true, userDisabled: false, incognito: false, pinned: false });
  a.chrome.userUninstall(E1);
  await rounds([a, b]);
  b.legacy = false;
  await rounds([b, a]);
  assert.deepEqual([a.ids(), b.ids()], [[], [E1]]);
  assert.deepEqual(a.state.records[extensionKey(E1)]!.v, { removed: true });
});

test("Chrome's own reading of the same version's permissions is added, and Macs that differ settle without a loop", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E3);
  await rounds([a, b]);
  b.chrome.installed.get(E3)!.fingerprint = "all-hosts,newer-chrome";
  await rounds([b, a]);
  assert.deepEqual(a.state.records[extensionApprovalKey(E3)]!.v, { v: "3.0", fps: ["all-hosts", "all-hosts,newer-chrome"] });
  const seq = [a.state.seq, b.state.seq];
  await rounds([a, b]);
  assert.deepEqual([a.state.seq, b.state.seq], seq);
});

test("an install still settling isn't published with Chrome's defaults", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1, { pinned: true });
  await rounds([a, b]);
  b.chrome.installed.get(E1)!.pinned = false;
  b.chrome.settling = [E1];
  await rounds([b, a]);
  assert.equal(a.chrome.installed.get(E1)!.pinned, true);
});

test("on a framework without the engine calls nothing is published or applied, and the records wait", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a]);
  const read = b.chrome.host().read;
  b.adapter = extensionsAdapter({ ...b.chrome.host(), read: async () => null });
  b.chrome.userInstall(E2);
  await rounds([b, a]);
  assert.deepEqual([b.ids(), b.chrome.changes.length], [[E2], 0]);
  assert.equal(extensionKey(E2) in a.state.records, false);
  assert.ok(b.state.unapplied.includes(extensionKey(E1)));
  b.adapter = extensionsAdapter({ ...b.chrome.host(), read });
  await rounds([b, a]);
  assert.deepEqual([a.ids(), b.ids()], [[E1, E2], [E1, E2]]);
});

test("a joining Mac whose extensions weren't ready when it joined still keeps and publishes its own", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  const c = new Mac("devC", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a]);
  a.chrome.userUninstall(E1);
  await rounds([a]);
  c.chrome.userInstall(E1);
  c.chrome.intents = {};
  c.chrome.ready = false;
  await rounds([c], 2);
  assert.equal(c.state.joined, true);
  c.chrome.ready = true;
  await rounds([c, b]);
  assert.deepEqual(c.state.records[extensionKey(E1)]!.v, { on: true, inc: false, pin: false });
  assert.deepEqual(b.ids(), [E1]);
});

test("a change Chrome refuses isn't acknowledged: the edit stays to apply and the local state isn't published over it", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await rounds([a, b]);
  a.chrome.installed.get(E1)!.pinned = true;
  await a.sync();
  b.chrome.failing = true;
  await rounds([b, b]);
  assert.ok(b.state.unapplied.includes(extensionKey(E1)));
  assert.deepEqual(a.state.records[extensionKey(E1)]!.v, { on: true, inc: false, pin: true });
  await rounds([a]);
  assert.equal(a.chrome.installed.get(E1)!.pinned, true);
  b.chrome.failing = false;
  await rounds([b, a]);
  assert.deepEqual([a.chrome.installed.get(E1)!.pinned, b.chrome.installed.get(E1)!.pinned], [true, true]);
});

test("a removal reaching an install that a restart left queued cancels it", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder, { joining: true });
  a.chrome.userInstall(E1);
  await a.sync();
  b.chrome.finishInstalls = () => {};
  await b.sync();
  assert.equal(b.chrome.pending.has(E1), true);
  b.chrome.pending.clear();
  b.chrome.queued = [E1];
  a.chrome.userUninstall(E1);
  await a.sync();
  await b.sync();
  assert.deepEqual(b.chrome.queued, []);
  assert.ok(b.chrome.changes.some((c) => c.kind === "cancel" && c.id === E1));
});

test("an install whose read is still out when quitting begins doesn't happen, and waits to be applied", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder);
  a.chrome.userInstall(E1);
  await rounds([a]);
  let quitting = false;
  let armed = false;
  const host = b.chrome.host();
  const adapter = extensionsAdapter({
    ...host,
    read: async () => {
      const local = await host.read();
      if (armed) quitting = true;
      return local;
    },
  });
  const held: Adapter = { ...adapter, apply: (...args) => ((armed = true), adapter.apply(...args)) };
  folder.now += 10;
  await syncScope({ scope: "p", state: b.state, transport: folder.transport(), adapters: [held], clock: b.clock, device: b.id, now: () => folder.now, options: { holdApply: () => quitting } });
  assert.deepEqual(b.chrome.changes, [], "nothing is installed once quitting has begun");
  assert.ok(b.state.unapplied.includes(extensionKey(E1)), "and the record waits");
  armed = false;
  await adapter.reconcile(visible(b.state, "ext:"), folder.now, () => quitting);
  assert.deepEqual(b.chrome.changes, [], "reconciling holds too");
  quitting = false;
  await b.sync();
  b.chrome.finishInstalls();
  assert.deepEqual(b.ids(), [E1], "after a cancelled quit it installs");
});

test("reconciling stops before installing when quitting begins during its read", async () => {
  const folder = new Folder();
  const a = new Mac("devA", folder);
  const b = new Mac("devB", folder);
  a.chrome.userInstall(E1);
  await rounds([a]);
  b.chrome.failing = true;
  await b.sync();
  b.chrome.failing = false;
  b.chrome.changes = [];
  let quitting = false;
  const host = b.chrome.host();
  const adapter = extensionsAdapter({ ...host, read: async () => ((quitting = true), host.read()) });
  await adapter.reconcile(visible(b.state, "ext:"), folder.now + 10 * 60_000, () => quitting);
  assert.deepEqual(b.chrome.changes, []);
});
