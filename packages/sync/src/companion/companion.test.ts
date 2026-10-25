import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical } from "../canon.ts";
import { Clock } from "../hlc.ts";
import { compact, emptyScope, syncScope, visible, type Adapter, type Listing, type LogFile, type ScopeState, type Transport } from "../scope.ts";
import {
  companionAcknowledge,
  companionAddBookmark,
  companionLoad,
  companionRemoveBookmark,
  companionRemovalsDone,
  companionSend,
  runCompanionCycle,
  type CompanionState,
  type CycleInput,
  type Host,
} from "./cycle.ts";
import type { LocalTab, LocalVisit } from "./adapters.ts";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 1);
const PHONE = "phone0000000000000000000000";
const MAC = "mac00000000000000000000000";

type Entry = { payload: string; partial?: boolean };

class Folder {
  scopes = new Map<string, Map<string, Entry>>();
  counter = 0;
  now = START;
  chain = true;
  scope(name: string) {
    let s = this.scopes.get(name);
    if (!s) this.scopes.set(name, (s = new Map()));
    return s;
  }
  listing(scope: string, known: string[]): Listing {
    const listing: Listing = { files: [], pending: [], damaged: [], present: [] };
    for (const [id, e] of this.scope(scope)) {
      listing.present.push(id);
      if (known.includes(id)) continue;
      if (e.partial) listing.damaged.push({ id, age: 0 });
      else listing.files.push({ id, payload: e.payload });
    }
    return listing;
  }
  add(scope: string, payload: string, partial = false) {
    const id = `f${String(++this.counter).padStart(4, "0")}`;
    this.scope(scope).set(id, { payload, partial });
    return id;
  }
  transport(): Transport {
    return {
      write: async (scope, payload) => this.add(scope, payload),
      read: async (scope, known) => this.listing(scope, known),
      remove: async (scope, ids) => {
        for (const id of ids) this.scope(scope).delete(id);
      },
    };
  }
  logs(device: string): LogFile[] {
    const out: LogFile[] = [];
    for (const scope of this.scopes.values()) {
      for (const e of scope.values()) {
        const file = JSON.parse(e.payload) as LogFile;
        if (file.kind === "log" && file.device === device) out.push(file);
      }
    }
    return out;
  }
  fileCount() {
    return [...this.scopes.values()].reduce((n, s) => n + s.size, 0);
  }
}

type HistoryEntry = { t: string; vt: number[] };

class Mac {
  scopes: Record<string, ScopeState> = {};
  store: Record<string, Map<string, unknown>> = {};
  history: Record<string, Map<string, HistoryEntry>> = {};
  clock: Clock;
  readonly folder: Folder;
  readonly id: string;
  constructor(folder: Folder, id = MAC) {
    this.folder = folder;
    this.id = id;
    this.clock = new Clock(id, null, () => folder.now);
  }
  put(scope: string, key: string, value: unknown) {
    (this.store[scope] ??= new Map()).set(key, value);
  }
  remove(scope: string, key: string) {
    this.store[scope]?.delete(key);
  }
  visit(scope: string, url: string, title: string, at: number) {
    const map = (this.history[scope] ??= new Map());
    const e = map.get(url) ?? { t: title, vt: [] };
    e.vt = [...e.vt, at].sort((a, z) => a - z).slice(-50);
    e.t = title;
    map.set(url, e);
  }
  adapters(scope: string): Adapter[] {
    const store = (this.store[scope] ??= new Map());
    const history = (this.history[scope] ??= new Map());
    return [
      {
        prefix: "h:",
        extract: (base) => {
          const values = new Map<string, unknown>();
          for (const [url, e] of history) {
            const key = `h:${url}`;
            const local = { t: e.t, n: e.vt.length, vt: e.vt };
            const known = base(key) as { vt: number[] } | undefined;
            const edited = !known || local.vt.some((t) => !known.vt.some((k) => Math.abs(k - t) <= 1));
            values.set(key, edited ? local : known);
          }
          return { values };
        },
        editedAt: (v) => Math.max(...(v as { vt: number[] }).vt),
        apply: (view, changed) => {
          for (const key of changed) {
            const url = key.slice(2);
            const v = view.get(key) as { t: string; vt: number[] } | undefined;
            if (!v) {
              history.delete(url);
              continue;
            }
            const have = history.get(url)?.vt ?? [];
            const fresh = v.vt.filter((t) => !have.some((h) => Math.abs(h - t) <= 1));
            history.set(url, { t: v.t, vt: [...have, ...fresh].sort((a, z) => a - z).slice(-50) });
          }
        },
      },
      {
        prefix: "",
        extract: () => ({ values: new Map(store), ignore: (k) => k.startsWith("h:") }),
        apply: (view, changed) => {
          for (const key of changed) {
            if (key.startsWith("h:")) continue;
            if (view.has(key)) store.set(key, view.get(key));
            else store.delete(key);
          }
        },
      },
    ];
  }
  async sync(scopes: string[] = Object.keys({ app: 1, ...this.store, ...this.history })) {
    for (const scope of scopes) {
      await syncScope({
        scope,
        state: (this.scopes[scope] ??= emptyScope()),
        transport: this.folder.transport(),
        adapters: this.adapters(scope),
        clock: this.clock,
        device: this.id,
        now: () => this.folder.now,
      });
    }
  }
}

class Phone {
  stateJSON: string | null = null;
  journal: Record<string, LogFile[]> = {};
  failWrite: "before" | "after" | null = null;
  tabs: LocalTab[] = [];
  visits: LocalVisit[] = [];
  name = "iPhone";
  readonly folder: Folder;
  readonly id: string;
  constructor(folder: Folder, id = PHONE) {
    this.folder = folder;
    this.id = id;
  }
  host(): Host {
    return {
      chainStatus: () => (this.folder.chain ? "ok" : "missing"),
      read: (scope, known) => JSON.stringify(this.folder.listing(scope, JSON.parse(known) as string[])),
      write: (scope, payload) => {
        if (this.failWrite === "before") throw new Error("disk full");
        const id = this.folder.add(scope, payload);
        if (this.failWrite === "after") throw new Error("crashed after the move");
        return id;
      },
      remove: () => "",
      persistJournal: (scope, batches) => {
        const list = (this.journal[scope] ??= []);
        for (const f of (JSON.parse(batches) as string[]).map((raw) => JSON.parse(raw) as LogFile)) if (!list.some((x) => x.seq === f.seq)) list.push(f);
        return "ok";
      },
      saveState: (json, seqs) => {
        this.stateJSON = json;
        const saved = JSON.parse(seqs) as Record<string, number>;
        for (const [scope, list] of Object.entries(this.journal)) {
          const left = list.filter((f) => f.seq > (saved[scope] ?? 0));
          if (left.length) this.journal[scope] = left;
          else delete this.journal[scope];
        }
        return "ok";
      },
    };
  }
  launch() {
    (globalThis as { __host?: Host }).__host = this.host();
    companionLoad({ device: this.id, state: this.stateJSON ? (JSON.parse(this.stateJSON) as CompanionState) : null, journal: this.journal, fresh: !this.stateJSON });
    return this;
  }
  cycle(extra: Partial<CycleInput> = {}) {
    (globalThis as { __host?: Host }).__host = this.host();
    return runCompanionCycle({ name: this.name, now: this.folder.now, tabs: this.tabs, visits: this.visits, ...extra });
  }
  state(): CompanionState {
    return JSON.parse(this.stateJSON!) as CompanionState;
  }
}

const P1 = "profile1default000000000000";
const P2 = "profile2work0000000000000000";
const P3 = "profile3school00000000000000";
const s1 = `p:${P1}`;
const s2 = `p:${P2}`;
const s3 = `p:${P3}`;

function seedMac(mac: Mac) {
  mac.put("app", `dev:${MAC}`, { n: "MacBook Pro" });
  mac.put("app", `prof:${P1}`, { n: "Personal", c: "blue", i: null, d: true });
  mac.put("app", `prof:${P2}`, { n: "Work", c: "green", i: "briefcase" });
  mac.put("app", `prof:${P3}`, { n: "School", c: "pink", i: null });
  mac.put("app", `share:${P3}`, { o: P1 });
  mac.put("app", `pth:${P1}`, { t: { stops: [{ color: { r: 1, g: 0.5, b: 0, a: 1 }, x: 0, y: 0 }, { color: { r: 0, g: 0, b: 1, a: 0.5 }, x: 1, y: 1 }], intensity: 0.6, grain: 0, texture: "grain", translucency: 1, mode: "auto" } });
  mac.put("app", `pth:${P1}:angle`, { a: 45 });
  mac.put("app", "set:searchEngine", { v: "duckduckgo" });
  mac.put("app", "set:customSearchUrl", { v: "" });
  mac.put("app", "set:customSearchEngines", { v: [{ id: "c1", name: "Docs", keyword: "docs", url: "https://docs.example/?q=%s" }] });
  mac.put("app", "set:appearance", { v: "dark" });
  mac.put("app", "set:shortcuts", { v: { newTab: "cmd+t" } });
  mac.put(s1, `tabs:${MAC}`, { n: "MacBook Pro", tabs: [{ u: "https://news.example/", t: "News" }, { u: "https://mail.example/", t: "Mail" }] });
  mac.put(s1, "pin:t:t1", { g: null, u: "https://calendar.example/", t: null, i: null, ti: "Calendar", pos: "1" });
  mac.put(s1, "pin:t:t2", { g: null, u: "https://a.example/", t: "A", i: null, ti: "A page", pos: "2" });
  mac.put(s1, "pin:t:t3", { g: null, u: "https://b.example/", t: null, i: "star", ti: "B page", pos: "3" });
  mac.put(s1, "tilefold:t2", { f: "F" });
  mac.put(s1, "tilefold:t3", { f: "F" });
  mac.put(s1, "tilefold:n:F", { n: "Reading" });
  mac.put(s1, "pin:t:r1", { g: null, u: "https://r1.example/", t: null, i: null, ti: "Row one", pos: "4" });
  mac.put(s1, "pin:t:r2", { g: null, u: "https://r2.example/", t: null, i: null, ti: "Row two", pos: "5" });
  mac.put(s1, "pinrow:r1", 1);
  mac.put(s1, "pinrow:r2", 1);
  mac.put(s1, "pinrow:t1", 0);
  mac.put(s1, "pin:g:G1", { n: "Projects", i: null, c: "blue", pos: "6" });
  mac.put(s1, "pin:t:m1", { g: "G1", u: "https://m1.example/", t: null, i: null, ti: "Member one", pos: "1" });
  mac.put(s1, "pin:t:m2", { g: "G1", u: "https://m2.example/", t: null, i: null, ti: "Member two", pos: "2" });
  mac.put(s1, "pinn:g:N1", { n: "Sub", i: null, c: "red", p: "G1" });
  mac.put(s1, "pinn:t:m2", { g: "N1" });
  mac.put(s1, "pord:g:G1", { a: "r1" });
  mac.put(s1, "bm:f1", { k: "f", p: "bar", t: "Work", a: 1, pos: "1" });
  mac.put(s1, "bm:b1", { k: "u", p: "f1", t: "Docs", u: "https://docs.example/", a: 2, pos: "2" });
  mac.put(s1, "bm:b0", { k: "u", p: "f1", t: "Wiki", u: "https://wiki.example/", a: 3, pos: "1" });
  mac.put(s1, "bm:orphan", { k: "u", p: "gone", t: "Orphan", u: "https://orphan.example/", a: 4, pos: "5" });
  mac.put(s1, "bm:c1", { k: "f", p: "c2", t: "Loop A", a: 5, pos: "1" });
  mac.put(s1, "bm:c2", { k: "f", p: "c1", t: "Loop B", a: 6, pos: "1" });
  mac.put(s1, "bm:legacy", { k: "u", p: "bar", t: "Game", u: "netnyahoo://yahu", a: 7, pos: "2" });
  mac.put(s1, "pw:https://bank.example\nluke", { o: "https://bank.example", u: "luke", p: "hunter2" });
  mac.put(s1, "ext:abc", { on: true, inc: false, pin: true });
  mac.visit(s1, "https://read.example/", "Reading", START - 2 * DAY);
  mac.put(s2, `tabs:${MAC}`, { n: "MacBook Pro", tabs: [{ u: "https://work.example/", t: "Work" }] });
  mac.put(s3, `tabs:${MAC}`, { n: "MacBook Pro", tabs: [] });
}

async function joined() {
  const folder = new Folder();
  const mac = new Mac(folder);
  seedMac(mac);
  await mac.sync();
  folder.now += 1000;
  const phone = new Phone(folder).launch();
  return { folder, mac, phone };
}

const recordsWithout = (scopes: Record<string, ScopeState>, keys: string[]) =>
  canonical(Object.fromEntries(Object.entries(scopes).map(([scope, s]) => [scope, Object.fromEntries(Object.entries(s.records).filter(([k]) => !keys.includes(k)))])));

test("the iPhone never tombstones or rewrites a record it doesn't own", async () => {
  const { folder, mac, phone } = await joined();
  phone.tabs = [{ u: "https://phone.example/", t: "Phone", at: START }];
  const before = recordsWithout(mac.scopes, []);
  for (let i = 0; i < 12; i++) {
    folder.now += 15_000;
    await phone.cycle();
    if (i === 5) {
      phone.launch();
      await mac.sync();
    }
  }
  await mac.sync();
  const own = [`dev:${PHONE}`, `tabs:${PHONE}`];
  assert.equal(recordsWithout(mac.scopes, own), before);
  const written = new Set(folder.logs(PHONE).flatMap((f) => f.ops.map((op) => op.k)));
  assert.deepEqual([...written].sort(), own);
  assert.ok(folder.logs(PHONE).every((f) => f.ops.every((op) => op.v !== null)));
});

test("unchanged tabs and an idle iPhone write no files", async () => {
  const { folder, phone } = await joined();
  phone.tabs = [{ u: "https://phone.example/", t: "Phone", at: START }];
  await phone.cycle();
  const count = folder.fileCount();
  for (let i = 0; i < 5; i++) {
    folder.now += 15_000;
    const out = await phone.cycle();
    assert.equal(out.published, 0);
  }
  assert.equal(folder.fileCount(), count);
});

test("the tabs record holds the 30 most recently active web tabs", async () => {
  const { mac, phone } = await joined();
  phone.tabs = [
    ...Array.from({ length: 40 }, (_, i) => ({ u: `https://site${i}.example/`, t: `Site ${i}`, at: START + i })),
    { u: "about:blank", t: "Blank", at: START + 100 },
    { u: "https://work-phone.example/", t: "Work on phone", at: START, p: P2 },
  ];
  await phone.cycle();
  await mac.sync();
  const tabs = mac.scopes[s1]!.records[`tabs:${PHONE}`]!.v as { n: string; k: string; tabs: { u: string }[] };
  assert.equal(tabs.k, "phone");
  assert.equal(tabs.tabs.length, 30);
  assert.equal(tabs.tabs[0]!.u, "https://site39.example/");
  assert.equal(tabs.tabs.at(-1)!.u, "https://site10.example/");
  assert.deepEqual((mac.scopes[s2]!.records[`tabs:${PHONE}`]!.v as { tabs: unknown[] }).tabs, [{ u: "https://work-phone.example/", t: "Work on phone" }]);
  assert.deepEqual(mac.scopes.app!.records[`dev:${PHONE}`]!.v, { n: "iPhone", k: "phone", f: ["send"], s: new Date(START + 1000).toISOString().slice(0, 10).replaceAll("-", "") });
});

test("history is the union both ways, and a deletion made on the Mac sticks", async () => {
  const { folder, mac, phone } = await joined();
  const read = "https://read.example/";
  const fresh = "https://fresh.example/";
  phone.visits = [
    { u: read, t: "Reading on phone", vt: [START - DAY] },
    { u: fresh, t: "Fresh", vt: [START - 3 * DAY] },
    { u: "https://old.example/", t: "Old", vt: [START - 120 * DAY] },
  ];
  await phone.cycle();
  await mac.sync();
  assert.deepEqual(mac.history[s1]!.get(read)!.vt, [START - 2 * DAY, START - DAY]);
  assert.deepEqual(mac.history[s1]!.get(fresh)!.vt, [START - 3 * DAY]);
  assert.equal(mac.history[s1]!.has("https://old.example/"), false);

  folder.now += 60_000;
  mac.visit(s1, read, "Reading", folder.now);
  await mac.sync();
  const logsBefore = folder.logs(PHONE).length;
  folder.now += 15_000;
  const out = await phone.cycle();
  assert.equal(folder.logs(PHONE).length, logsBefore);
  const item = out.view!.profiles.find((p) => p.syncId === P1)!.history.find((h) => h.url === read)!;
  assert.equal(item.lastVisit, folder.now - 15_000);

  folder.now += 60_000;
  mac.history[s1]!.delete(fresh);
  await mac.sync();
  folder.now += 15_000;
  const removed = await phone.cycle();
  assert.deepEqual(removed.historyRemoved, [
    { profile: P1, urls: [fresh], unassigned: true },
    { profile: P3, urls: [fresh], unassigned: false },
  ]);
  for (let i = 0; i < 3; i++) {
    folder.now += 15_000;
    await phone.cycle();
  }
  await mac.sync();
  assert.equal(mac.scopes[s1]!.records[`h:${fresh}`]!.v, null);
  assert.equal(mac.history[s1]!.has(fresh), false);

  folder.now += 60_000;
  phone.visits = [{ u: fresh, t: "Fresh again", vt: [START - 3 * DAY, folder.now] }];
  await phone.cycle();
  await mac.sync();
  assert.deepEqual(mac.history[s1]!.get(fresh)!.vt, [folder.now]);
});

test("visits in a profile that shares data go to the owner's history", async () => {
  const { mac, phone } = await joined();
  phone.visits = [{ u: "https://school.example/", t: "School", vt: [START], p: P3 }];
  const out = await phone.cycle();
  await mac.sync();
  assert.ok(mac.history[s1]!.has("https://school.example/"));
  assert.equal(mac.scopes[s3]!.records["h:https://school.example/"], undefined);
  const school = out.view!.profiles.find((p) => p.syncId === P3)!;
  assert.ok(school.history.some((h) => h.url === "https://school.example/"));
  assert.ok(school.history.some((h) => h.url === "https://read.example/"));
});

test("a send goes round trip both ways and is applied once", async () => {
  const { folder, mac, phone } = await joined();
  await phone.cycle();
  companionSend({ profile: P1, key: "11111111-1111-4111-8111-111111111111", u: "https://shared.example/", t: "Shared", to: MAC, at: folder.now });
  folder.now += 1000;
  await phone.cycle();
  await mac.sync();
  const key = "send:11111111-1111-4111-8111-111111111111";
  assert.deepEqual(mac.store[s1]!.get(key), { u: "https://shared.example/", t: "Shared", to: MAC, from: PHONE, at: folder.now - 1000 });
  mac.remove(s1, key);
  await mac.sync();
  folder.now += 1000;
  await phone.cycle();
  assert.equal(phone.state().sends.length, 0);
  assert.equal(mac.scopes[s1]!.records[key]!.v, null);

  const incoming = "send:22222222-2222-4222-8222-222222222222";
  mac.put(s1, incoming, { u: "https://from-mac.example/", t: "From Mac", to: PHONE, from: MAC, at: folder.now });
  mac.put(s1, "send:33333333-3333-4333-8333-333333333333", { u: "https://other.example/", t: "Other", to: "someoneelse00000000000000", from: MAC, at: folder.now });
  await mac.sync();
  folder.now += 1000;
  const first = await phone.cycle();
  assert.deepEqual(first.received.map((r) => [r.key, r.fromName, r.profile]), [[incoming, "MacBook Pro", P1]]);
  phone.launch();
  const again = await phone.cycle();
  assert.equal(again.received.length, 1);
  companionAcknowledge({ items: [{ profile: P1, key: incoming }] });
  phone.launch();
  folder.now += 1000;
  const acked = await phone.cycle();
  assert.equal(acked.received.length, 0);
  await mac.sync();
  assert.equal(mac.store[s1]!.has(incoming), false);
  assert.ok(mac.store[s1]!.has("send:33333333-3333-4333-8333-333333333333"));
  assert.equal(phone.state().acks.length, 0);
});

test("a send to a device that stays offline is dropped after 7 days", async () => {
  const { folder, mac, phone } = await joined();
  await phone.cycle();
  companionSend({ profile: P1, key: "44444444-4444-4444-8444-444444444444", u: "https://later.example/", t: "Later", to: "offline0000000000000000000", at: folder.now });
  await phone.cycle();
  folder.now += 6 * DAY;
  await phone.cycle();
  assert.equal(phone.state().sends.length, 1);
  folder.now += 2 * DAY;
  await phone.cycle();
  assert.equal(phone.state().sends.length, 0);
  await mac.sync();
  assert.equal(mac.scopes[s1]!.records["send:44444444-4444-4444-8444-444444444444"]!.v, null);
});

for (const when of ["before", "after"] as const) {
  test(`a crash ${when} a write sends the journalled batch again byte for byte and never reuses its seq`, async () => {
    const { folder, phone } = await joined();
    await phone.cycle();
    const saved = phone.stateJSON;
    phone.tabs = [{ u: "https://crash.example/", t: "Crash", at: folder.now }];
    phone.failWrite = when;
    folder.now += 1000;
    await assert.rejects(phone.cycle());
    const journalled = Object.values(phone.journal).flat();
    assert.equal(journalled.length, 1);
    const batch = JSON.stringify(journalled[0]);
    phone.stateJSON = saved;
    phone.failWrite = null;
    phone.launch();
    const before = folder.counter;
    folder.now += 1000;
    await phone.cycle();
    const written = [...folder.scopes.values()].flatMap((s) => [...s].filter(([id]) => Number(id.slice(1)) > before).map(([, e]) => e.payload));
    assert.equal(written[0], batch);
    const logs = folder.logs(PHONE);
    assert.equal(new Set(logs.map((f) => JSON.stringify(f))).size, when === "after" ? logs.length - 1 : logs.length);
    phone.tabs = [{ u: "https://next.example/", t: "Next", at: folder.now }];
    folder.now += 1000;
    await phone.cycle();
    const tabSeqs = folder.logs(PHONE).filter((f) => f.ops.some((op) => op.k === `tabs:${PHONE}` && (op.v as { tabs: { u: string }[] }).tabs[0]?.u === "https://next.example/")).map((f) => f.seq);
    assert.deepEqual(tabSeqs, [journalled[0]!.seq + 1]);
    assert.deepEqual(Object.keys(phone.journal), []);
  });
}

test("the iPhone joins a folder that already has a Mac snapshot and logs", async () => {
  const folder = new Folder();
  const mac = new Mac(folder);
  seedMac(mac);
  await mac.sync();
  for (let i = 0; i < 5; i++) {
    folder.now += 1000;
    mac.put(s1, `bm:extra${i}`, { k: "u", p: "other", t: `Extra ${i}`, u: `https://extra${i}.example/`, a: i, pos: `${i + 6}` });
    await mac.sync([s1]);
  }
  folder.now += 2 * 3_600_000;
  await compact(mac.scopes[s1]!, folder.transport(), s1, MAC, folder.now, {}, true);
  folder.now += 1000;
  mac.put(s1, "bm:afterSnapshot", { k: "u", p: "other", t: "After", u: "https://after.example/", a: 9, pos: "z" });
  await mac.sync([s1]);
  const kinds = [...folder.scope(s1).values()].map((e) => (JSON.parse(e.payload) as { kind: string }).kind);
  assert.ok(kinds.includes("snapshot") && kinds.includes("log"));
  const phone = new Phone(folder).launch();
  const out = await phone.cycle();
  const personal = out.view!.profiles.find((p) => p.syncId === P1)!;
  const other = personal.bookmarks.filter((b) => b.root === "other").map((b) => b.title);
  assert.ok(["Extra 0", "Extra 4", "After"].every((t) => other.includes(t)));
  assert.equal(personal.deviceTabs[0]!.tabs.length, 2);
});

test("a damaged file is not applied until it is whole", async () => {
  const { folder, mac, phone } = await joined();
  await phone.cycle();
  const payload = JSON.stringify({ v: 1, kind: "log", device: MAC, seq: 999, at: folder.now, ops: [{ k: "bm:late", h: new Clock(MAC, null, () => folder.now).tick(), v: { k: "u", p: "other", t: "Late", u: "https://late.example/", a: 1, pos: "y" } }] });
  const id = folder.add(s1, payload, true);
  const out = await phone.cycle();
  assert.equal(phone.state().scopes[s1]!.records["bm:late"], undefined);
  assert.equal(out.view, undefined);
  folder.scope(s1).get(id)!.partial = false;
  const whole = await phone.cycle();
  assert.ok(whole.view!.profiles.find((p) => p.syncId === P1)!.bookmarks.some((b) => b.title === "Late"));
  void mac;
});

test("the view orders pins, bookmarks, profiles and search as the Mac does", async () => {
  const { phone } = await joined();
  const { view } = await phone.cycle();
  assert.ok(view);
  assert.deepEqual(
    view.profiles.map((p) => [p.name, p.isDefault]),
    [["Personal", true], ["School", false], ["Work", false]],
  );
  const personal = view.profiles[0]!;
  assert.deepEqual(personal.theme, { colors: ["#FF8000", "#0000FF80"], darkColors: null });
  assert.deepEqual(
    personal.pinned.tiles.map((t) => [t.key, t.title, t.folder?.map((f) => f.title) ?? null]),
    [["t1", "Calendar", null], ["tilefold:F", "Reading", ["A", "B page"]]],
  );
  const describe = (s: (typeof personal.pinned.sections)[number]): unknown =>
    "tab" in s ? s.tab.key : { [s.group.name]: s.group.items.map(describe) };
  assert.deepEqual(personal.pinned.sections.map(describe), ["r1", { Projects: ["m1", { Sub: ["m2"] }] }, "r2"]);
  const shape = (b: (typeof personal.bookmarks)[number]): unknown => (b.children ? { [b.title]: b.children.map(shape) } : b.title);
  assert.deepEqual(personal.bookmarks.filter((b) => b.root === "bar").map(shape), [{ Work: ["Wiki", "Docs"] }, "Game"]);
  assert.deepEqual(personal.bookmarks.filter((b) => b.root === "other").map(shape), [{ "Loop A": [{ "Loop B": [] }] }, "Orphan"]);
  assert.equal(personal.bookmarks.find((b) => b.title === "Game")!.url, "ardia://game");
  assert.deepEqual(view.search, { engineId: "duckduckgo", customURL: null, customEngines: [{ id: "c1", name: "Docs", keyword: "docs", url: "https://docs.example/?q=%s" }] });
  const school = view.profiles.find((p) => p.name === "School")!;
  assert.deepEqual(school.bookmarks, personal.bookmarks);
  assert.deepEqual(school.deviceTabs, []);
  assert.deepEqual(
    view.devices.map((d) => [d.name, d.kind, d.isCurrent, d.canReceiveTabs]),
    [["iPhone", "phone", true, true], ["MacBook Pro", "mac", false, false]],
  );
});

test("bookmarks added on the iPhone land after the last of Other Bookmarks, and a folder delete takes its children", async () => {
  const { folder, mac, phone } = await joined();
  await phone.cycle();
  companionAddBookmark({ profile: P1, key: "55555555-5555-4555-8555-555555555555", u: "https://saved.example/", t: "Saved", at: folder.now });
  companionAddBookmark({ profile: P3, key: "66666666-6666-4666-8666-666666666666", u: "https://saved2.example/", t: "Saved two", at: folder.now });
  await phone.cycle();
  await mac.sync();
  const first = mac.store[s1]!.get("bm:55555555-5555-4555-8555-555555555555") as { p: string; pos: string };
  const second = mac.store[s1]!.get("bm:66666666-6666-4666-8666-666666666666") as { p: string; pos: string };
  assert.equal(first.p, "other");
  assert.ok(first.pos > "5" && second.pos > first.pos && !first.pos.endsWith("0"));
  assert.equal(phone.state().bookmarks.length, 0);
  companionRemoveBookmark({ profile: P1, key: "f1" });
  folder.now += 1000;
  await phone.cycle();
  await mac.sync();
  assert.deepEqual(["bm:f1", "bm:b0", "bm:b1"].map((k) => mac.store[s1]!.has(k)), [false, false, false]);
  assert.ok(mac.store[s1]!.has("bm:orphan"));
  assert.equal(phone.state().bookmarks.length, 0);
});

test("stopping removes the iPhone's device and tabs from the Mac's view", async () => {
  const { folder, mac, phone } = await joined();
  phone.tabs = [{ u: "https://phone.example/", t: "Phone", at: START }];
  await phone.cycle();
  await mac.sync();
  assert.ok(mac.store.app!.has(`dev:${PHONE}`));
  folder.now += 1000;
  await phone.cycle({ retiring: true });
  await mac.sync();
  assert.equal(mac.store.app!.has(`dev:${PHONE}`), false);
  assert.equal(visible(mac.scopes[s1]!, "tabs:").has(`tabs:${PHONE}`), false);
  assert.ok(mac.store[s1]!.has("bm:f1"));
});

test("a chain that disappeared reports a reset and writes nothing", async () => {
  const { folder, phone } = await joined();
  await phone.cycle();
  folder.chain = false;
  const count = folder.fileCount();
  const out = await phone.cycle();
  assert.equal(out.status, "missing");
  assert.equal(folder.fileCount(), count);
});

test("history a Mac deleted stays deleted after its tombstone is collected into a snapshot", async () => {
  const { folder, mac, phone } = await joined();
  const url = "https://secret.example/";
  phone.visits = [{ u: url, t: "Secret", vt: [START - DAY] }];
  await phone.cycle();
  await mac.sync();
  assert.ok(mac.history[s1]!.has(url));
  folder.now += 60_000;
  mac.history[s1]!.delete(url);
  await mac.sync();
  folder.now += 46 * DAY;
  await compact(mac.scopes[s1]!, folder.transport(), s1, MAC, folder.now, {}, true);
  assert.equal(mac.scopes[s1]!.records[`h:${url}`], undefined);
  folder.now += 15_000;
  phone.launch();
  const first = await phone.cycle();
  assert.deepEqual(first.historyRemoved, [
    { profile: P1, urls: [url], unassigned: true },
    { profile: P3, urls: [url], unassigned: false },
  ]);
  for (let i = 0; i < 3; i++) {
    folder.now += 15_000;
    await phone.cycle();
  }
  await mac.sync();
  assert.equal(mac.history[s1]!.has(url), false);
  assert.equal(mac.scopes[s1]!.records[`h:${url}`], undefined);
});

test("a saved state is never swapped for a fresh one under the same device id", async () => {
  const { phone } = await joined();
  await phone.cycle();
  assert.throws(() => companionLoad({ device: PHONE, state: null, journal: {} }));
  assert.throws(() => companionLoad({ device: PHONE, state: { ...phone.state(), device: "someoneelse00000000000000" }, journal: {} }));
  assert.throws(() => companionLoad({ device: PHONE, state: { ...phone.state(), v: 2 } as unknown as CompanionState, journal: {} }));
  assert.doesNotThrow(() => companionLoad({ device: "brandnew00000000000000000", state: null, journal: {}, fresh: true }));
});

test("only devices that sync a profile receive tabs sent in it, and a send in a profile that isn't synced is refused", async () => {
  const { folder, mac, phone } = await joined();
  mac.put("app", `dev:${MAC}`, { n: "MacBook Pro", k: "mac", f: ["send"] });
  await mac.sync();
  const out = await phone.cycle();
  const targets = Object.fromEntries(out.view!.profiles.map((p) => [p.name, p.sendTargets]));
  assert.deepEqual(targets, { Personal: [MAC], School: [MAC], Work: [MAC] });
  const other = new Mac(folder, "macmini0000000000000000000");
  other.put("app", `dev:${other.id}`, { n: "Mac mini", k: "mac", f: ["send"] });
  await other.sync(["app"]);
  const later = await phone.cycle();
  assert.deepEqual(later.view!.profiles.find((p) => p.name === "Personal")!.sendTargets, [MAC]);
  assert.ok(later.view!.devices.some((d) => d.id === other.id && d.canReceiveTabs));
  assert.deepEqual(companionSend({ profile: "notaprofile000000000000000", key: "77777777-7777-4777-8777-777777777777", u: "https://x.example/", t: "X", to: MAC, at: folder.now }), { saved: false, refused: true });
  assert.deepEqual(companionAddBookmark({ profile: "notaprofile000000000000000", key: "88888888-8888-4888-8888-888888888888", u: "https://x.example/", t: "X", at: folder.now }), { saved: false, refused: true });
  assert.equal(phone.state().sends.length, 0);
  assert.equal(phone.state().bookmarks.length, 0);
});

test("an idle cycle doesn't serialize the whole state", async () => {
  const { folder, phone } = await joined();
  phone.tabs = [{ u: "https://phone.example/", t: "Phone", at: START }];
  await phone.cycle();
  await phone.cycle();
  const stringify = JSON.stringify;
  let whole = 0;
  JSON.stringify = ((value: unknown, ...rest: unknown[]) => {
    if (value && typeof value === "object" && "scopes" in value && "device" in value) whole++;
    return (stringify as (...a: unknown[]) => string)(value, ...rest);
  }) as typeof JSON.stringify;
  try {
    for (let i = 0; i < 3; i++) {
      folder.now += 15_000;
      await phone.cycle();
    }
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(whole, 0);
});

test("a phone visit that lost to a concurrent Mac record is sent again from its full local list", async () => {
  const { folder, mac, phone } = await joined();
  const url = "https://shared.example/";
  await phone.cycle({ visits: [] });
  await mac.sync();
  folder.now += 60_000;
  const lost = folder.now;
  await phone.cycle({ visits: [{ u: url, t: "Shared", vt: [lost], p: P1 }] });
  folder.now += 20_000;
  mac.visit(s1, url, "Shared", folder.now);
  await mac.sync();
  folder.now += 15_000;
  const noticed = await phone.cycle({ visits: null });
  assert.deepEqual(noticed.visitsDue, [url]);
  folder.now += 15_000;
  const repaired = await phone.cycle({ visits: [{ u: url, t: "Shared", vt: [lost], p: P1 }], fetchedDue: [url] });
  assert.deepEqual(repaired.visitsDue, []);
  await mac.sync();
  assert.ok(mac.history[s1]!.get(url)!.vt.includes(lost));
  folder.now += 15_000;
  assert.deepEqual((await phone.cycle({ visits: null })).visitsDue, []);
});

test("a removal stays pending until the phone says it removed it, even when the cycle that found it fails", async () => {
  const { folder, mac, phone } = await joined();
  const url = "https://secret.example/";
  await phone.cycle({ visits: [{ u: url, t: "Secret", vt: [START - DAY], p: P1 }] });
  await mac.sync();
  folder.now += 60_000;
  mac.history[s1]!.delete(url);
  await mac.sync();
  folder.now += 15_000;
  const host = phone.host();
  (globalThis as { __host?: Host }).__host = { ...host, read: (scope, known) => (scope === s2 ? (() => { throw new Error("timed out"); })() : host.read(scope, known)) };
  await assert.rejects(runCompanionCycle({ name: "iPhone", now: folder.now, tabs: [], visits: null }));
  folder.now += 15_000;
  const first = await phone.cycle({ visits: null });
  assert.deepEqual(first.historyRemoved.map((r) => [r.profile, r.urls, r.unassigned]), [[P1, [url], true], [P3, [url], false]]);
  folder.now += 15_000;
  assert.equal((await phone.cycle({ visits: null })).historyRemoved.length, 2);
  companionRemovalsDone({ items: first.historyRemoved });
  folder.now += 15_000;
  assert.deepEqual((await phone.cycle({ visits: null })).historyRemoved, []);
});

test("a record that only aged out of a snapshot is not a deletion, and a Mac clock ahead never sets a future floor", async () => {
  const { folder, mac, phone } = await joined();
  const old = "https://old.example/";
  await phone.cycle({ visits: [{ u: old, t: "Old", vt: [START - 80 * DAY], p: P1 }] });
  await mac.sync();
  folder.now += 11 * DAY;
  await compact(mac.scopes[s1]!, folder.transport(), s1, MAC, folder.now, { expired: (k, v, now) => k.startsWith("h:") && Math.max(...(v as { vt: number[] }).vt) < now - 90 * DAY }, true);
  const out = await phone.cycle({ visits: null });
  assert.deepEqual(out.historyRemoved, []);
  assert.equal(phone.state().floors[s1]?.[old], undefined);

  const ahead = new Mac(folder, "macahead000000000000000000");
  ahead.clock = new Clock(ahead.id, null, () => folder.now + 30 * DAY);
  const url = "https://ahead.example/";
  ahead.put(s1, `h:${url}`, { t: "Ahead", n: 1, vt: [folder.now - DAY] });
  await ahead.sync([s1]);
  await phone.cycle({ visits: null });
  ahead.remove(s1, `h:${url}`);
  await ahead.sync([s1]);
  folder.now += 15_000;
  await phone.cycle({ visits: null });
  assert.ok(phone.state().floors[s1]![url]! <= folder.now);
});

test("the phone's device record carries the day, so an idle phone still says it's around once a day", async () => {
  const { folder, phone } = await joined();
  await phone.cycle();
  const day = (at: number) => new Date(at).toISOString().slice(0, 10).replaceAll("-", "");
  const records = () => folder.logs(PHONE).flatMap((f) => f.ops).filter((op) => op.k === `dev:${PHONE}`);
  assert.deepEqual(records().map((op) => op.v), [{ n: "iPhone", k: "phone", f: ["send"], s: day(folder.now) }]);
  for (let i = 0; i < 4; i++) {
    folder.now += 3_600_000;
    await phone.cycle();
  }
  assert.equal(records().length, day(folder.now) === day(folder.now - 4 * 3_600_000) ? 1 : 2);
  folder.now += DAY;
  await phone.cycle();
  assert.equal((records().at(-1)!.v as { s: string }).s, day(folder.now));
});

test("a phone that starts over under a new id deletes its old device and tabs records", async () => {
  const { folder, mac, phone } = await joined();
  phone.tabs = [{ u: "https://old-id.example/", t: "Old", at: START }];
  await phone.cycle();
  await mac.sync();
  const fresh = new Phone(folder, "phonenew00000000000000000");
  fresh.tabs = [{ u: "https://new-id.example/", t: "New", at: folder.now }];
  (globalThis as { __host?: Host }).__host = fresh.host();
  companionLoad({ device: fresh.id, state: null, journal: {}, fresh: true, ghosts: [PHONE] });
  for (let i = 0; i < 2; i++) {
    folder.now += 15_000;
    await fresh.cycle();
  }
  await mac.sync();
  assert.equal(mac.store.app!.has(`dev:${PHONE}`), false);
  for (const scope of [s1, s2, s3]) assert.equal(mac.store[scope]!.has(`tabs:${PHONE}`), false);
  assert.ok(mac.store.app!.has(`dev:${fresh.id}`));
  assert.ok(mac.store[s1]!.has("bm:f1"));
});
