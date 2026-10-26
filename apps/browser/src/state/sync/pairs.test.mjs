import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { Clock, compact, emptyScope, syncScope } = await import("@ardia/sync");
const pinnedArea = await import("./pinned.ts");
const { pinnedOrderAdapter } = await import("./pinnedOrderAdapter.ts");
const { pinnedRowsAdapter } = await import("./pinnedRowsAdapter.ts");
const stub = await import("../../test-native/index.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const shipped = await import("../../../../../packages/sync/src/fixtures/scope-v0.2.38.ts");
const { pinnedAdapter: shippedPinnedAdapter } = await import("./fixtures/pinned-v0.2.38.ts");

const S = () => useBrowser.getState();
const PROFILES = ["default", "work"];
let wall = 1_900_000_000_000;
const now = () => ++wall;
const DAY = 86_400_000;

class Folder {
  files = new Map();
  hidden = new Set();
  counter = 0;
  clone() {
    const f = new Folder();
    f.files = new Map(this.files);
    f.counter = this.counter;
    return f;
  }
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const shown = [...this.files].filter(([id, f]) => f.scope === scope && !this.hidden.has(id));
        const files = shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Mac {
  constructor(id, folder, browser, scopes = {}, legacy = false) {
    this.id = id;
    this.folder = folder;
    this.browser = browser;
    this.scopes = scopes;
    this.legacy = legacy;
    this.sent = [];
    this.clock = new Clock(id, null, now);
  }
  with(fn) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync(profiles = PROFILES) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    let published = 0;
    try {
      for (const p of profiles) {
        const state = (this.scopes[p] ??= emptyScope());
        const before = new Map(Object.entries(state.records).map(([key, r]) => [key, r.h]));
        const result = await (this.legacy ? shipped.syncScope : syncScope)({
          scope: `p:${p}`,
          state: (this.scopes[p] ??= emptyScope()),
          transport: this.folder.transport(),
          adapters: this.legacy ? [shippedPinnedAdapter(p)] : [pinnedRowsAdapter(p), pinnedOrderAdapter(p), pinnedArea.pinnedAdapter(p)],
          clock: this.clock,
          device: this.id,
          now: () => wall,
        });
        published += result.published;
        for (const [key, r] of Object.entries(state.records)) if (r.o[0] === this.id && before.get(key) !== r.h) this.sent.push({ p, key, v: r.v });
      }
    } finally {
      this.browser = S();
    }
    return published;
  }
  fork(folder) {
    return new Mac(this.id, folder, this.browser, structuredClone(this.scopes), this.legacy);
  }
  relaunch() {
    this.with(() => {
      const saved = S();
      stub.docs.clear();
      const stop = startPersistence();
      useBrowser.setState(saved, true);
      flushPersistence();
      stop();
      S().hydrate(loadSession());
    });
    this.scopes = JSON.parse(JSON.stringify(this.scopes));
    this.clock = new Clock(this.id, null, now);
  }
  async compact(days = 46) {
    wall += days * DAY;
    for (const p of PROFILES) if (this.scopes[p]) await (this.legacy ? shipped.compact : compact)(this.scopes[p], this.folder.transport(), `p:${p}`, this.id, wall, {}, true);
  }
}

const WORK = { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 };
function freshMac(id, folder, legacy = false) {
  S().hydrate({});
  useBrowser.setState((s) => ({ profiles: { ...s.profiles, work: WORK }, profileOrder: [...s.profileOrder, "work"] }));
  const mac = new Mac(id, folder, S(), {}, legacy);
  mac.with(() => {
    S().createWindow({ url: `https://${id}-home.example/` });
    S().createWindow({ profileId: "work", url: `https://${id}-work.example/` });
  });
  return mac;
}

const keyOf = (t) => t.pinKey ?? t.id;
const inContainer = (s, t) => t.pinned || Object.values(s.groups).some((g) => g.pinned && g.tabIds.includes(t.id));
function tabFor(key, profileId) {
  const s = S();
  const all = Object.values(s.tabs).filter((t) => keyOf(t) === key && (!profileId || t.profileId === profileId));
  const shown = (t) => s.windows[t.windowId]?.profileId === t.profileId;
  return all.find((t) => inContainer(s, t) && shown(t)) ?? all.find((t) => inContainer(s, t)) ?? all.find((t) => t.navigation) ?? all[0];
}
const groupFor = (key) => Object.values(S().groups).find((g) => keyOf(g) === key && g.pinned) ?? Object.values(S().groups).find((g) => keyOf(g) === key);

const worlds = new Map();
async function world(startRow) {
  if (worlds.has(startRow)) return worlds.get(startRow);
  const folder = new Folder();
  const a = freshMac("devA", folder);
  const b = freshMac("devB", folder);
  const old = freshMac("devOld", folder, true);
  const k = {};
  a.with(() => {
    const wd = Object.values(S().windows).find((x) => x.profileId === "default").id;
    k.T = S().newTab(wd, { url: "https://t.example/" });
    k.X = S().newTab(wd, { url: "https://x.example/" });
    k.M = S().newTab(wd, { url: "https://m.example/" });
    k.R = S().newTab(wd, { url: "https://r.example/" });
    S().pinTabs([k.T], true);
    S().pinTabs([k.X], true, startRow);
    k.G = S().groupTabs([k.M], { pinned: true, name: "G" });
    const ww = Object.values(S().windows).find((x) => x.profileId === "work").id;
    k.W1 = S().newTab(ww, { url: "https://w1.example/" });
    S().pinTabs([k.W1], true, true);
  });
  for (let i = 0; i < 3; i++) for (const m of [a, b, old]) await m.sync();
  const w = { folder, a, b, old, k, startRow, wall };
  worlds.set(startRow, w);
  return w;
}

const X_OTHER = "https://x.example/other";
const M_REMOTE = "https://m.example/remote";
const M_THIRD = "https://m.example/third";
function sentBy(k, key, device) {
  return (k.macs?.[device]?.sent ?? []).filter((x) => x.p === "default" && x.key === `pin:t:${key}`).map((x) => x.v);
}
const doneBy = (k, name) => [...k.done].find((d) => d.startsWith(`${name}@`))?.slice(name.length + 1);
const everSent = (k, key, name, url) => sentBy(k, key, doneBy(k, name)).some((v) => v?.u === url);
const inPinnedGroup = (key) => Object.values(S().groups).some((g) => g.pinned && g.tabIds.includes(tabFor(key)?.id));
function navigate(key, url) {
  const t = tabFor(key);
  if (t) useBrowser.setState((s) => ({ tabs: { ...s.tabs, [t.id]: { ...s.tabs[t.id], url, unloaded: undefined, navigation: { url, seq: (s.tabs[t.id].navigation?.seq ?? 0) + 1 } } } }));
  return !!t;
}
const record = (mac, p, key) => mac.scopes[p]?.records[key]?.v;
function loadX(k) {
  const t = tabFor(k.X);
  if (t) useBrowser.setState((s) => ({ tabs: { ...s.tabs, [t.id]: { ...s.tabs[t.id], unloaded: undefined, navigation: { url: t.url, seq: 1 } } } }));
}
function parkAndReopen() {
  for (const w of Object.values(S().windows)) if (w.profileId === "default") S().closeWindow(w.id);
  S().createWindow({ url: "https://reopened.example/" });
}
function mirrorWindow() {
  S().createWindow({ url: "https://mirror.example/" });
}
const done = (k, name) => k.done.add(`${name}@${stub.current.device}`);
const did = (k, op, mac) => k.done?.has(`${op.name}@${mac.id}`);
const OPS = [
  { name: "none", steps: [() => {}], touches: [] },
  { name: "unpinX", steps: [(k) => { const t = tabFor(k.X); if (t && inContainer(S(), t)) (S().pinTabs([t.id], false), done(k, "unpinX")); }], touches: ["X"], unpins: ["X"], final: (k) => assert.equal(!!tabFor(k.X) && inContainer(S(), tabFor(k.X)), false, "X unpinned") },
  {
    name: "repinX",
    steps: [(k) => { const t = tabFor(k.X); if (t) (S().pinTabs([t.id], false), S().pinTabs([t.id], true, true), done(k, "repinX")); }],
    touches: ["X", "X.kind"],
    final: (k) => assert.ok(tabFor(k.X)?.pinned && tabFor(k.X).pinnedAsRow, "X pinned again as a row"),
  },
  {
    name: "xTile",
    steps: [(k) => { const t = tabFor(k.X); if (t?.pinned && t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: false }), done(k, "xTile")); }],
    touches: ["X.kind"],
    final: (k) => { const t = tabFor(k.X); if (t?.pinned) assert.equal(!!t.pinnedAsRow, false, "X a tile"); },
  },
  {
    name: "xRow",
    steps: [(k) => { const t = tabFor(k.X); if (t?.pinned && !t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: true }), done(k, "xRow")); }],
    touches: ["X.kind"],
    final: (k) => { const t = tabFor(k.X); if (t?.pinned) assert.equal(!!t.pinnedAsRow, true, "X a row"); },
  },
  {
    name: "moveXIntoG",
    steps: [(k) => { const t = tabFor(k.X); const g = groupFor(k.G); if (t && g?.pinned) (S().placeTabs([t.id], { pinned: false, groupId: g.id }), done(k, "moveXIntoG")); }],
    touches: ["X", "G"],
    final: (k) => assert.ok(tabFor(k.X) && inContainer(S(), tabFor(k.X)), "X pinned, in G or on its own once G is gone"),
  },
  {
    name: "createHMoveX",
    steps: [
      (k) => { const w = Object.values(S().windows).find((x) => x.profileId === "default"); S().groupTabs([S().newTab(w.id, { url: "https://h.example/", background: true })], { pinned: true, name: "H" }); },
      (k) => { const h = Object.values(S().groups).find((g) => g.name === "H"); const t = tabFor(k.X); if (h && t) (S().placeTabs([t.id], { pinned: false, groupId: h.id }), done(k, "createHMoveX")); },
    ],
    touches: ["X", "H"],
    final: (k) => {
      const hs = Object.values(S().groups).filter((g) => g.name === "H" && g.pinned);
      assert.ok(hs.length, "H pinned");
      const urls = (g) => g.tabIds.map((id) => S().tabs[id].pinnedUrl ?? S().tabs[id].url);
      assert.ok(hs.every((h) => urls(h)[0] === "https://h.example/"), "each H keeps its first tab");
      assert.ok(hs.some((h) => h.tabIds.includes(tabFor(k.X)?.id)), "X in H");
    },
  },
  { name: "unpinG", steps: [(k) => { const g = groupFor(k.G); if (g?.pinned) (S().moveGroup(g.id, { pinned: false }), done(k, "unpinG")); }], touches: ["G", "M"], unpins: ["G", "M"], keeps: ["G", "M"], losesGroupTo: ["navM", "navMThereAndBack", "navMThenMirrorAndClose"], final: (k) => assert.equal(!!groupFor(k.G)?.pinned, false, "G unpinned") },
  {
    name: "repinG",
    steps: [(k) => { const g = groupFor(k.G); if (g) (S().moveGroup(g.id, { pinned: false }), S().moveGroup(g.id, { pinned: true }), done(k, "repinG")); }],
    touches: ["G", "M"],
    final: (k) => assert.ok(groupFor(k.G)?.pinned && groupFor(k.G).tabIds.some((id) => keyOf(S().tabs[id]) === k.M), "G pinned with M"),
  },
  { name: "deleteG", steps: [(k) => { const g = groupFor(k.G); if (g) (S().deleteGroup(g.id), done(k, "deleteG")); }], touches: ["G", "M"], unpins: ["G", "M"], final: (k) => assert.equal(!!groupFor(k.G)?.pinned, false, "G deleted") },
  {
    name: "renameX",
    steps: [(k) => { const t = tabFor(k.X); if (t) (S().updateTab(t.id, { customTitle: "Renamed" }), done(k, "renameX")); }],
    touches: ["X"],
    final: (k, mac) => {
      const t = tabFor(k.X);
      if (!t || !inContainer(S(), t)) return;
      assert.equal(t.customTitle, "Renamed", "X renamed");
      assert.equal(record(mac, "default", `pin:t:${k.X}`)?.t, "Renamed", "X renamed in its record");
    },
  },
  { name: "loadX", steps: [loadX], touches: [] },
  { name: "loadXThenPark", steps: [loadX, parkAndReopen], touches: [] },
  { name: "loadXThenMirror", steps: [loadX, mirrorWindow], touches: [] },
  { name: "park", steps: [parkAndReopen], touches: [] },
  { name: "mirror", steps: [mirrorWindow], touches: [] },
  { name: "relaunch", steps: [{ lifecycle: (k, mac) => mac.relaunch() }], touches: [] },
  {
    name: "unpinGThenCompact",
    steps: [(k) => { const g = groupFor(k.G); if (g?.pinned) (S().moveGroup(g.id, { pinned: false }), done(k, "unpinGThenCompact")); }, { lifecycle: (k, mac) => mac.compact() }],
    touches: ["G", "M"],
    unpins: ["G", "M"],
    keeps: ["G", "M"],
    losesGroupTo: ["navM", "navMThereAndBack", "navMThenMirrorAndClose"],
    lastEdit: 0,
    collects: true,
    final: (k) => assert.equal(!!groupFor(k.G)?.pinned, false, "G unpinned"),
  },
  {
    name: "navXIntoG",
    steps: [
      (k) => {
        const t = tabFor(k.X);
        if (!t) return;
        useBrowser.setState((s) => ({ tabs: { ...s.tabs, [t.id]: { ...s.tabs[t.id], url: X_OTHER, unloaded: undefined, navigation: { url: X_OTHER, seq: 2 } } } }));
        const g = groupFor(k.G);
        if (g?.pinned) (S().placeTabs([t.id], { pinned: false, groupId: g.id }), done(k, "navXIntoG"));
      },
    ],
    touches: ["X", "G"],
    final: (k, mac) => {
      assert.ok(tabFor(k.X) && inContainer(S(), tabFor(k.X)), "X pinned, in G or on its own once G is gone");
      assert.ok(everSent(k, k.X, "navXIntoG", X_OTHER), "the page X was moved with is sent");
    },
  },
  {
    name: "styleG",
    steps: [(k) => { const g = groupFor(k.G); if (g?.pinned) (S().updateGroup(g.id, { icon: "star", color: "green" }), done(k, "styleG")); }],
    touches: ["G"],
    final: (k, mac) => {
      const g = groupFor(k.G);
      if (!g?.pinned) return;
      assert.deepEqual([g.icon, g.color], ["star", "green"], "G restyled");
      assert.deepEqual([record(mac, "default", `pin:g:${k.G}`)?.i, record(mac, "default", `pin:g:${k.G}`)?.c], ["star", "green"], "G restyled in its record");
    },
  },
  {
    name: "navM",
    steps: [(k) => { if (navigate(k.M, M_REMOTE)) done(k, "navM"); }],
    touches: ["M"],
    final: (k) => { if (inPinnedGroup(k.M)) assert.ok(everSent(k, k.M, "navM", M_REMOTE), "M's new page is sent"); },
  },
  {
    name: "navMThereAndBack",
    steps: [
      (k) => { const t = tabFor(k.M); if (t) (navigate(k.M, t.url), (k.mStart = { ...k.mStart, [stub.current.device]: t.url })); },
      (k) => { if (k.mStart?.[stub.current.device]) navigate(k.M, "https://m.example/away"); },
      (k) => { const start = k.mStart?.[stub.current.device]; if (start && navigate(k.M, start)) done(k, "navMThereAndBack"); },
    ],
    touches: ["M"],
    final: (k, mac) => {
      if (!inPinnedGroup(k.M) || !k.done.has(`navMThereAndBack@${mac.id}`)) return;
      assert.equal(sentBy(k, k.M, mac.id).at(-1)?.u, k.mStart[mac.id], "going back to where M started is sent");
    },
  },
  {
    name: "navMThenMirrorAndClose",
    steps: [
      (k) => { const t = tabFor(k.M); if (t && inPinnedGroup(k.M)) (k.mHome = t.windowId), (k.mOlder = S().createWindow({ url: "https://old-mirror.example/" })); },
      (k) => {
        if (!k.mHome || !S().windows[k.mHome] || !inPinnedGroup(k.M)) return;
        S().setFocusedWindow(k.mHome);
        navigate(k.M, M_THIRD);
        k.mNewer = S().createWindow({ url: "https://new-mirror.example/", background: true });
        S().setFocusedWindow(k.mOlder);
      },
      (k) => { if (k.mNewer && S().windows[k.mHome]) (S().closeWindow(k.mHome), S().setFocusedWindow(k.mNewer), done(k, "navMThenMirrorAndClose")); },
    ],
    touches: ["M"],
    final: (k) => { if (inPinnedGroup(k.M)) assert.ok(everSent(k, k.M, "navMThenMirrorAndClose", M_THIRD), "M's page, copied to a new mirror before it was sent, is sent"); },
  },
  {
    name: "workRoundTrip",
    steps: [
      { run: (k) => { const t = tabFor(k.W1, "work"); if (t?.pinned) (S().moveTabToProfile(t.id, "default"), (k.moved = true), (k.w1Row = !!t.pinnedAsRow)); }, sync: ["default"] },
      (k) => { const t = k.moved && tabFor(k.W1, "default"); if (t) (S().moveTabToProfile(t.id, "work"), done(k, "workRoundTrip")); },
    ],
    touches: ["W1", "W1.kind"],
    final: (k) => assert.ok(tabFor(k.W1, "work")?.pinned && !!tabFor(k.W1, "work").pinnedAsRow === k.w1Row, "W1 back in Work as the kind it was"),
  },
  {
    name: "workTile",
    steps: [(k) => { const t = tabFor(k.W1, "work"); if (t?.pinned && t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: false }), done(k, "workTile")); }],
    touches: ["W1.kind"],
    final: (k) => { const t = tabFor(k.W1, "work"); if (t?.pinned) assert.equal(!!t.pinnedAsRow, false, "W1 a tile"); },
  },
];

const stepOf = (s) => (typeof s === "function" ? { run: s } : s);

async function runStep(mac, step, k) {
  if (step.run) mac.with(() => step.run(k));
  if (step.lifecycle) await step.lifecycle(k, mac);
}

async function runOp(mac, op, k, { syncs = true, hideFirst = false, folder } = {}) {
  for (const [i, step] of op.steps.map(stepOf).entries()) {
    await runStep(mac, step, k);
    if (!syncs) continue;
    const before = new Set(folder.files.keys());
    await mac.sync(step.sync);
    if (hideFirst && i === 0) for (const id of folder.files.keys()) if (!before.has(id)) folder.hidden.add(id);
  }
}

const SCHEDULES = {
  "A then B": async (w, opA, opB) => {
    await runOp(w.a, opA, w.k, { folder: w.folder });
    await w.b.sync();
    await runOp(w.b, opB, w.k, { folder: w.folder });
    return "B";
  },
  "both, A syncs first": async (w, opA, opB) => {
    await runStep(w.a, stepOf(opA.steps[0]), w.k);
    await runStep(w.b, stepOf(opB.steps[0]), w.k);
    await w.a.sync();
    await w.b.sync();
    await runOp(w.a, { steps: opA.steps.slice(1) }, w.k, { folder: w.folder });
    await runOp(w.b, { steps: opB.steps.slice(1) }, w.k, { folder: w.folder });
    const lastEdit = (op) => op.lastEdit ?? op.steps.length - 1;
    return lastEdit(opB) > 0 || lastEdit(opA) === 0 ? "B" : "A";
  },
  "B's log delayed": async (w, opA, opB) => {
    const before = new Set(w.folder.files.keys());
    await runOp(w.b, opB, w.k, { folder: w.folder });
    for (const id of w.folder.files.keys()) if (!before.has(id)) w.folder.hidden.add(id);
    await runOp(w.a, opA, w.k, { folder: w.folder });
    w.folder.hidden.clear();
    return "A";
  },
  "both, with an older Mac": async (w, opA, opB) => {
    w.withOld = true;
    return SCHEDULES["both, A syncs first"](w, opA, opB);
  },
  "A's first log 44 days late, C joins from a snapshot meanwhile": async (w, opA, opB) => {
    await runOp(w.a, opA, w.k, { folder: w.folder, hideFirst: true });
    await w.b.sync();
    await runOp(w.b, opB, w.k, { folder: w.folder });
    await w.b.compact(44);
    w.c = freshMac("devC", w.folder);
    await w.c.sync();
    w.folder.hidden.clear();
    return "B";
  },
  "A's first log delayed": async (w, opA, opB) => {
    await runOp(w.a, opA, w.k, { folder: w.folder, hideFirst: true });
    await w.b.sync();
    await runOp(w.b, opB, w.k, { folder: w.folder });
    w.folder.hidden.clear();
    return "B";
  },
};

function structure(mac) {
  mac.with(() => {
    const s = S();
    for (const win of Object.values(s.windows)) {
      assert.ok(win.tabIds.length, `${mac.id}: window ${win.id} has tabs`);
      for (const id of win.tabIds) assert.equal(s.tabs[id]?.windowId, win.id, `${mac.id}: ${id} belongs to ${win.id}`);
      for (const id of Object.values(win.activeTabIds)) assert.equal(s.tabs[id]?.windowId, win.id, `${mac.id}: active tab in ${win.id}`);
      for (const p of PROFILES) {
        const pinnedMember = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
        const rank = (id) => (s.tabs[id].pinned ? (s.tabs[id].pinnedAsRow ? 1 : 0) : pinnedMember.has(id) ? 1 : 2);
        const ranks = win.tabIds.filter((id) => s.tabs[id]?.profileId === p).map(rank);
        assert.deepEqual(ranks, [...ranks].sort(), `${mac.id}: tiles, then rows and pinned groups, then tabs in ${win.id}`);
      }
    }
    for (const v of Object.values(s.splits)) for (const id of v.tabIds) assert.equal(s.tabs[id]?.windowId, v.windowId, `${mac.id}: split in its window`);
    for (const g of Object.values(s.groups)) for (const id of g.tabIds) assert.equal(s.tabs[id]?.windowId, g.windowId, `${mac.id}: group ${g.name} keeps its members in its window`);
  });
}

function signature(mac, { rows = true } = {}) {
  return mac.with(() => {
    const s = S();
    const out = {};
    const meta = (t) => `${keyOf(t)}|${t.customTitle ?? ""}|${t.customIcon ?? ""}|${t.pinned ? (t.pinnedUrl ?? "") : ""}`;
    const parked = (t) => `${t.id}|${t.customTitle ?? ""}|${t.customIcon ?? ""}|${t.groupId ? "" : (t.pinnedUrl ?? "")}`;
    for (const p of PROFILES) {
      const win = Object.values(s.windows).find((w) => w.profileId === p);
      const ids = win ? win.tabIds.filter((id) => s.tabs[id]?.profileId === p) : [];
      const park = s.parkedPins[p];
      const isRow = (t) => rows && !!t.pinnedAsRow;
      out[p] = {
        tiles: ids.filter((id) => s.tabs[id].pinned && !isRow(s.tabs[id])).map((id) => meta(s.tabs[id])).concat((park?.tabs ?? []).filter((t) => !t.groupId && !isRow(t)).map(parked)),
        rows: ids.filter((id) => s.tabs[id].pinned && isRow(s.tabs[id])).map((id) => meta(s.tabs[id])).concat((park?.tabs ?? []).filter((t) => !t.groupId && isRow(t)).map(parked)),
        groups: Object.values(s.groups)
          .filter((g) => g.pinned && g.profileId === p && g.windowId === win?.id)
          .sort((x, z) => ids.indexOf(x.tabIds[0]) - ids.indexOf(z.tabIds[0]))
          .map((g) => [keyOf(g), g.name, g.icon, g.color, g.tabIds.map((id) => meta(s.tabs[id]))])
          .concat((park?.groups ?? []).map((g) => [g.id, g.name, g.icon, g.color, park.tabs.filter((t) => t.groupId === g.id).map(parked)])),
      };
    }
    return out;
  });
}

function records(mac, { rows = true, loose = new Set() } = {}) {
  const out = {};
  for (const p of PROFILES)
    out[p] = Object.fromEntries(
      Object.entries(mac.scopes[p]?.records ?? {})
        .filter(([key, r]) => r.v !== null && (rows || !key.startsWith("pinrow:")))
        .map(([key, r]) => [key, JSON.stringify(loose.has(`${p}|${key}`) ? { ...r.v, u: undefined, ti: undefined } : r.v)])
        .sort(([x], [z]) => (x < z ? -1 : 1)),
    );
  return out;
}

const touched = (op) => new Set(op.touches);
const overlap = (a, b) => [...touched(a)].some((t) => touched(b).has(t));

async function runPair(startRow, opA, opB, schedule) {
  const base = await world(startRow);
  wall = base.wall;
  const folder = base.folder.clone();
  const w = { folder, a: base.a.fork(folder), b: base.b.fork(folder), k: { ...base.k, done: new Set() } };
  w.k.macs = { [w.a.id]: w.a, [w.b.id]: w.b };
  const later = await SCHEDULES[schedule](w, opA, opB);
  const macs = [w.a, w.b, ...(w.c ? [w.c] : []), ...(w.withOld ? [base.old.fork(folder)] : [])];
  for (let i = 0; i < 4; i++) for (const m of macs) await m.sync();
  const stamps = () => macs.map((m) => Object.fromEntries(PROFILES.flatMap((p) => Object.entries(m.scopes[p]?.records ?? {}).map(([key, r]) => [`${p}|${key}`, r.h]))));
  const before = stamps();
  let idle = 0;
  for (const m of macs) idle += await m.sync();
  const after = stamps();
  const resent = new Set(after.flatMap((st, i) => Object.keys(st).filter((key) => st[key] !== before[i][key])));
  const pingPong = (scoped, among = macs) => {
    const [p, key] = scoped.split("|");
    if (!key.startsWith("pin:t:")) return false;
    const pages = new Set();
    let holders = 0;
    for (const m of among) m.with(() => {
      const shown = Object.values(S().tabs).filter((t) => t.profileId === p && keyOf(t) === key.slice(6) && inContainer(S(), t) && !t.unloaded);
      if (shown.length) holders++;
      for (const t of shown) pages.add(`${t.url}|${t.title}`);
    });
    return holders >= 2 && pages.size >= 2;
  };
  if (idle && [...resent].every((key) => pingPong(key))) idle = 0;
  const resentBy = async (among) => {
    const was = among.map((m) => Object.fromEntries(PROFILES.flatMap((p) => Object.entries(m.scopes[p]?.records ?? {}).map(([key, r]) => [`${p}|${key}`, r.h]))));
    let sent = 0;
    for (const m of among) sent += await m.sync();
    const now = among.map((m) => Object.fromEntries(PROFILES.flatMap((p) => Object.entries(m.scopes[p]?.records ?? {}).map(([key, r]) => [`${p}|${key}`, r.h]))));
    return sent > 0 && !now.flatMap((st, i) => Object.keys(st).filter((key) => st[key] !== was[i][key])).every((key) => pingPong(key, among));
  };
  const looseAmong = (among) => new Set(among.flatMap((m) => PROFILES.flatMap((p) => Object.keys(m.scopes[p]?.records ?? {}).map((key) => `${p}|${key}`))).filter((key) => pingPong(key, among)));
  const loose = looseAmong(macs);
  for (const m of macs) structure(m);
  assert.deepEqual(signature(w.b), signature(w.a), "both Macs converge");
  assert.deepEqual(records(w.b, { loose }), records(w.a, { loose }), "both Macs hold the same records");
  if (w.c) {
    assert.deepEqual(signature(w.c), signature(w.a), "the Mac that joined from the snapshot converges");
    assert.deepEqual(records(w.c, { loose }), records(w.a, { loose }), "and holds the same records");
  }
  assert.equal(idle, 0, "nothing more is sent once settled");
  for (const p of PROFILES) {
    const live = records(w.a)[p];
    for (const [key, json] of Object.entries(live)) {
      const g = key.startsWith("pin:t:") && JSON.parse(json).g;
      if (g) assert.ok(live[`pin:g:${g}`], `${key} is in a group that exists`);
    }
  }
  if (w.withOld) {
    const old = macs.at(-1);
    assert.deepEqual(signature(old, { rows: false }), signature(w.a, { rows: false }), "the older Mac converges, rows as tiles");
    assert.deepEqual(records(old, { rows: false, loose }), records(w.a, { rows: false, loose }), "and holds the same pin records");
  }
  if (schedule === "B's log delayed") {
    const fresh = freshMac("devC", folder);
    for (let i = 0; i < 3; i++) for (const m of [fresh, w.a, w.b]) await m.sync();
    assert.deepEqual(signature(fresh), signature(w.a), "a Mac joining afterwards gets the same pins");
    const joined = looseAmong([fresh, w.a, w.b]);
    assert.deepEqual(records(fresh, { loose: joined }), records(w.a, { loose: joined }), "and the same records");
    assert.equal(await resentBy([fresh, w.a, w.b]), false, "and nothing is sent once it has joined, except pages two Macs show differently");
  }
  const removed = new Set([...(did(w.k, opA, w.a) ? (opA.unpins ?? []) : []), ...(did(w.k, opB, w.b) ? (opB.unpins ?? []) : [])]);
  for (const m of [w.a, w.b]) {
    m.with(() => {
      for (const name of ["T", "X", "M", "W1"]) {
        if (removed.has(name) || [opA, opB].some((o) => o.touches.includes(name))) continue;
        const t = tabFor(w.k[name]);
        assert.ok(t && inContainer(S(), t), `${m.id}: ${name} still pinned`);
      }
    });
  }
  const later_ = later === "A" ? opA : opB;
  for (const [m, op] of [[w.a, opA], [w.b, opB]]) {
    if (!did(w.k, op, m)) continue;
    const other = op === opA ? opB : opA;
    m.with(() => {
      for (const name of op.keeps ?? []) {
        if (name === "G" && op.losesGroupTo?.includes(other.name)) continue;
        if (name === "G") assert.ok(groupFor(w.k.G), `${m.id}: keeps the group it unpinned`);
        else assert.ok(tabFor(w.k[name]), `${m.id}: keeps ${name}`);
      }
    });
  }
  const ran = [[opA, w.a], [opB, w.b]].filter(([op, m]) => did(w.k, op, m) || !op.final);
  const collected = (opA.collects || opB.collects) && overlap(opA, opB);
  const finals = collected ? [] : overlap(opA, opB) && ran.some(([op]) => op === later_) ? [later_] : ran.map(([op]) => op);
  for (const op of finals) for (const m of [w.a, w.b]) if (op.final) m.with(() => op.final(w.k, m));
}

const cases = [];
for (const startRow of [true, false])
  for (const opA of OPS)
    for (const opB of OPS)
      for (const schedule of Object.keys(SCHEDULES)) if (!(schedule.includes("44 days late") && (opA.collects || opB.collects))) cases.push({ startRow, opA, opB, schedule });

test(`concurrent pinned-tab edits on two Macs converge (${cases.length} runs)`, async () => {
  const failures = [];
  for (const c of cases) {
    try {
      await runPair(c.startRow, c.opA, c.opB, c.schedule);
    } catch (error) {
      failures.push(`${c.startRow ? "row" : "tile"} X, A ${c.opA.name} / B ${c.opB.name}, ${c.schedule}: ${error.message.split("\n")[0]}`);
    }
  }
  if (failures.length) console.log(failures.join("\n"));
  assert.equal(failures.length, 0, `${failures.length} runs failed:\n${failures.slice(0, 40).join("\n")}`);
});

test("a pin waiting for a group that never arrives stands alone once the wait is over, even on an idle Mac", async () => {
  wall += DAY;
  const folder = new Folder();
  const b = freshMac("waitB", folder);
  const remote = new Clock("remote", null, () => wall);
  const value = { g: "never-seen", u: "https://wait.example/", t: null, i: null, ti: "Wait", pos: "V" };
  await folder.transport().write("p:default", JSON.stringify({ v: 1, kind: "log", device: "remote", seq: 1, at: wall, ops: [{ k: "pin:t:wait", h: remote.tick(), v: value }] }));
  await b.sync();
  assert.equal(record(b, "default", "pin:t:wait").g, "never-seen", "it waits at first");
  b.relaunch();
  wall += 89 * DAY;
  await b.sync();
  assert.equal(record(b, "default", "pin:t:wait").g, "never-seen", "still waiting within the 90-day hold");
  wall += 2 * DAY;
  for (let i = 0; i < 3; i++) await b.sync();
  assert.equal(record(b, "default", "pin:t:wait").g, null, "it stops waiting without any new change");
  b.relaunch();
  await b.sync();
  assert.equal(record(b, "default", "pin:t:wait").g, null, "and stays a standalone pin after a relaunch");
  b.with(() => assert.ok(tabFor("wait")?.pinned, "shown as a pin"));
});

const copyIn = (w, key) => Object.values(S().tabs).find((t) => t.windowId === w && keyOf(t) === key);
const load = (id, url) => useBrowser.setState((s) => ({ tabs: { ...s.tabs, [id]: { ...s.tabs[id], url, unloaded: undefined, navigation: { url, seq: (s.tabs[id].navigation?.seq ?? 0) + 1 } } } }));

const PAGE_CASES = {
  "a member navigated in a window behind another": async ({ a, b, k }, variant) => {
    let original;
    let mirror;
    b.with(() => {
      original = tabFor(k.M).windowId;
      mirror = S().createWindow({ url: "https://mirror.example/" });
    });
    await b.sync();
    await a.sync();
    b.with(() => {
      S().setFocusedWindow(original);
      navigate(k.M, "https://m.example/local-new");
      S().setFocusedWindow(mirror);
    });
    if (variant) {
      a.with(() => S().updateGroup(groupFor(k.G).id, { icon: "star" }));
      await a.sync();
    }
    await b.sync();
    b.with(() => S().setFocusedWindow(original));
    return { key: k.M, page: "https://m.example/local-new" };
  },
  "a page copied to a new mirror whose source window closes": async ({ a, b, k }, variant) => {
    let original;
    let older;
    let newer;
    b.with(() => {
      original = tabFor(k.M).windowId;
      older = S().createWindow({ url: "https://old-mirror.example/" });
    });
    for (const m of [b, a, b]) await m.sync();
    b.with(() => {
      S().setFocusedWindow(original);
      navigate(k.M, "https://m.example/unsent-copy");
      newer = S().createWindow({ url: "https://new-mirror.example/", background: true });
      S().setFocusedWindow(older);
    });
    await b.sync();
    b.with(() => (S().closeWindow(original), S().setFocusedWindow(newer)));
    if (variant) {
      a.with(() => S().updateGroup(groupFor(k.G).id, { icon: "star" }));
      await a.sync();
    }
    return { key: k.M, page: "https://m.example/unsent-copy" };
  },
  "a third window copied from a copy another window's page matches": async ({ a, b, k }, variant) => {
    const P = "https://m.example/p";
    const Q = "https://m.example/q";
    let w1;
    let w2;
    let w3;
    b.with(() => {
      w1 = tabFor(k.M).windowId;
      w2 = S().createWindow({ url: "https://second.example/" });
      S().setFocusedWindow(w1);
      navigate(k.M, Q);
    });
    for (const m of [b, a]) await m.sync();
    a.with(() => navigate(k.M, P));
    await a.sync();
    b.with(() => S().setFocusedWindow(w2));
    await b.sync();
    b.with(() => {
      load(copyIn(w2, k.M).id, Q);
      w3 = S().createWindow({ url: "https://third.example/", background: true });
      S().setFocusedWindow(w1);
    });
    await b.sync();
    b.with(() => (S().closeWindow(w2), S().setFocusedWindow(w3)));
    if (variant) {
      a.with(() => S().updateTab(tabFor(k.M).id, { customTitle: "Renamed" }));
      await a.sync();
    }
    return { key: k.M, page: Q };
  },
  "a new group's mirror navigated before its first sync": async ({ a, b }, variant) => {
    const P = "https://p.example/";
    const Q = "https://p.example/q";
    let key;
    let w1;
    let w2;
    b.with(() => {
      w1 = Object.values(S().windows).find((x) => x.profileId === "default").id;
      S().setFocusedWindow(w1);
      key = S().newTab(w1, { url: P, background: true });
      S().groupTabs([key], { pinned: true, name: "Fresh" });
      load(key, P);
      w2 = S().createWindow({ url: "https://second.example/" });
      S().activate(copyIn(w2, key).id);
      load(key, Q);
      S().setFocusedWindow(w1);
    });
    await b.sync();
    await a.sync();
    if (variant) {
      a.with(() => S().updateTab(tabFor(key).id, { customTitle: "Renamed" }));
      await a.sync();
      await b.sync();
    }
    b.with(() => S().setFocusedWindow(w2));
    return { key, page: Q };
  },
  "a member navigated and unpinned, then re-pinned into a group elsewhere": async ({ a, b, k }) => {
    const Q = "https://m.example/before-unpin";
    b.with(() => {
      navigate(k.M, Q);
      S().placeTabs([tabFor(k.M).id], { pinned: false, groupId: null });
    });
    await b.sync();
    await a.sync();
    a.with(() => S().groupTabs([Object.values(S().tabs).find((x) => keyOf(x) === k.M).id], { pinned: true, name: "Again" }));
    await a.sync();
    await b.sync();
    return { key: k.M, page: Q };
  },
  "a tile navigated and synced, then moved into a pinned group": async ({ b, k }) => {
    const Q = "https://x.example/navigated";
    b.with(() => navigate(k.X, Q));
    await b.sync();
    b.with(() => S().placeTabs([tabFor(k.X).id], { pinned: false, groupId: groupFor(k.G).id }));
    return { key: k.X, page: Q };
  },
  "a mirror copy navigated in front": async ({ a, b, k }) => {
    const R = "https://m.example/in-the-mirror";
    let mirror;
    b.with(() => (mirror = S().createWindow({ url: "https://mirror.example/" })));
    await b.sync();
    await a.sync();
    b.with(() => (S().setFocusedWindow(mirror), load(copyIn(mirror, k.M).id, R)));
    return { key: k.M, page: R };
  },
};

for (const [name, run] of Object.entries(PAGE_CASES)) {
  test(`a page change publishes as in 0.2.38: ${name}`, async () => {
    for (const variant of [false, true]) {
      const outcomes = [];
      for (const shipped of [true, false]) {
        const base = await world(false);
        wall = base.wall;
        const folder = base.folder.clone();
        const a = base.a.fork(folder);
        const b = base.b.fork(folder);
        b.legacy = shipped;
        const { key, page } = await run({ a, b, k: base.k }, variant);
        await b.sync();
        await a.sync();
        outcomes.push([record(b, "default", `pin:t:${key}`)?.u, record(a, "default", `pin:t:${key}`)?.u]);
        if (!variant) assert.deepEqual(outcomes.at(-1), [page, page], `${shipped ? "0.2.38" : "this build"}: the page is sent and reaches the other Mac`);
      }
      assert.deepEqual(outcomes[1], outcomes[0], `same outcome as 0.2.38${variant ? " with an edit from the other Mac" : ""}`);
    }
  });
}

test("known residual: two Macs with a pin loaded at different pages keep sending their pages", async () => {
  const base = await world(false);
  wall = base.wall;
  const folder = base.folder.clone();
  const a = base.a.fork(folder);
  const b = base.b.fork(folder);
  const k = base.k;
  a.with(() => navigate(k.M, "https://m.example/on-a"));
  b.with(() => navigate(k.M, "https://m.example/on-b"));
  const seen = new Set();
  for (let i = 0; i < 4; i++) for (const m of [a, b]) (await m.sync(), seen.add(record(m, "default", `pin:t:${k.M}`).u));
  assert.deepEqual([...seen].sort(), ["https://m.example/on-a", "https://m.example/on-b"], "documented in docs/sync.md: each sync sends its own page, as in 0.2.38");
  for (const m of [a, b]) m.with(() => assert.ok(inPinnedGroup(k.M), `${m.id}: nothing is lost`));
});

test("a Mac that unpinned a group keeps it, its name, style and members, when the other Mac restyles the pinned group", async () => {
  const base = await world(false);
  wall = base.wall;
  const folder = base.folder.clone();
  const a = base.a.fork(folder);
  const b = base.b.fork(folder);
  const k = base.k;
  let extra;
  a.with(() => {
    const g = groupFor(k.G);
    S().moveGroup(g.id, { pinned: false });
    S().updateGroup(g.id, { name: "Keep this local group", icon: "lock", color: "red" });
    extra = S().newTab(g.windowId, { url: "https://local-only.example/" });
    S().placeTabs([extra], { pinned: false, groupId: g.id });
  });
  b.with(() => S().updateGroup(groupFor(k.G).id, { icon: "star", color: "green" }));
  for (const m of [a, b, a, b, a]) await m.sync();
  a.with(() => {
    const kept = Object.values(S().groups).find((g) => !g.pinned && g.name === "Keep this local group");
    assert.ok(kept, "A keeps its regular group");
    assert.deepEqual([kept.icon, kept.color], ["lock", "red"], "with its style");
    assert.ok(kept.tabIds.includes(extra) && kept.tabIds.includes(tabFor(k.M)?.id), "and its members");
  });
  assert.deepEqual(signature(a), signature(b), "both Macs converge");
});

test("known conflict: a page change on a member while the other Mac unpins its group", async () => {
  for (const order of [["a", "b"], ["b", "a"]]) {
    const base = await world(false);
    wall = base.wall;
    const folder = base.folder.clone();
    const macs = { a: base.a.fork(folder), b: base.b.fork(folder) };
    const k = base.k;
    macs.a.with(() => S().moveGroup(groupFor(k.G).id, { pinned: false }));
    macs.b.with(() => navigate(k.M, M_REMOTE));
    for (let i = 0; i < 6; i++) for (const n of order) await macs[n].sync();
    assert.deepEqual(signature(macs.a), signature(macs.b), `both Macs converge (${order[0]} syncs first)`);
    for (const m of [macs.a, macs.b]) m.with(() => assert.ok(tabFor(k.M), `${m.id}: M is kept`));
    const pinnedM = macs.a.with(() => !!tabFor(k.M)?.pinned);
    const regularG = macs.a.with(() => Object.values(S().groups).some((g) => !g.pinned && keyOf(g) === k.G));
    assert.ok(pinnedM !== regularG, "documented in docs/sync.md: either M follows the unpin and A keeps its group, or M stays pinned on its own and A's group, whose only tab it was, goes");
  }
});

async function pinThenUnpinWithFirstLogLate() {
  wall += DAY;
  const folder = new Folder();
  const a = freshMac("lateA", folder);
  const b = freshMac("lateB", folder);
  await a.sync();
  await b.sync();
  let key;
  const before = new Set(folder.files.keys());
  a.with(() => {
    const wd = Object.values(S().windows).find((x) => x.profileId === "default").id;
    key = S().newTab(wd, { url: "https://late.example/" });
    S().pinTabs([key], true);
  });
  await a.sync();
  for (const id of folder.files.keys()) if (!before.has(id)) folder.hidden.add(id);
  a.with(() => S().pinTabs([key], false));
  const beforeSecond = new Set(folder.files.keys());
  await a.sync();
  const second = [...folder.files.keys()].filter((id) => !beforeSecond.has(id));
  await b.sync();
  const pinned = (mac) => mac.with(() => Object.values(S().tabs).some((t) => (t.pinKey ?? t.id) === key && t.pinned));
  return { folder, a, b, key, pinned, second };
}

test("known residual: a log delivered after the 90-day hold brings a deleted pin back", async () => {
  const { folder, b, pinned } = await pinThenUnpinWithFirstLogLate();
  assert.ok(b.scopes.default.extra.lateA?.length, "B is missing A's first log");
  await b.compact(46);
  assert.equal(pinned(b), false);
  await b.compact(45);
  folder.hidden.clear();
  await b.sync();
  assert.equal(pinned(b), true, "documented in docs/sync.md: the deletion's tombstone was collected at day 90");
});

test("known residual: a Mac joining from a snapshot during a gap holds tombstones only 45 days", async () => {
  const { folder, b, key, pinned, second } = await pinThenUnpinWithFirstLogLate();
  await b.compact(46);
  for (const id of second) folder.files.delete(id);
  const c = freshMac("lateC", folder);
  await c.sync();
  assert.equal(c.scopes.default.records[`pin:t:${key}`]?.v, null, "C has the tombstone from B's snapshot");
  assert.deepEqual(c.scopes.default.extra, {}, "but not B's gap");
  await c.compact(0);
  folder.hidden.clear();
  await c.sync();
  await b.sync();
  assert.equal(pinned(c), true, "documented in docs/sync.md: C collected it at 46 days");
  assert.equal(pinned(b), false, "B, which saw the gap, still holds it");
});

test("known residual: a log that never arrives keeps its gap and the logs after it", async () => {
  const { folder, a, b } = await pinThenUnpinWithFirstLogLate();
  wall += 200 * DAY;
  await a.sync();
  await b.sync();
  await b.compact(0);
  assert.ok(b.scopes.default.extra.lateA?.length, "documented in docs/sync.md: the gap stays open");
  const fromA = [...folder.files.values()].filter((f) => f.scope === "p:default" && JSON.parse(f.payload).kind === "log" && JSON.parse(f.payload).device === "lateA");
  assert.ok(fromA.length >= 1, "and A's later logs stay in the folder");
});
