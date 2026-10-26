import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const folders = await import("../pins/tileFolders.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const pinnedArea = await import("./pinned.ts");
const previous = await import("./fixtures/pinned-v0.2.40.ts");

const S = () => useBrowser.getState();

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
        const shown = [...this.files].filter(([, f]) => f.scope === scope);
        const files = shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder, adapters = () => pinnedArea.pinnedAreaAdapters("default")) {
    this.id = id;
    this.folder = folder;
    this.adapters = adapters;
    S().hydrate({});
    this.browser = S();
    this.scope = emptyScope();
    this.clock = new Clock(id);
  }
  with(fn) {
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync() {
    useBrowser.setState(this.browser, true);
    try {
      const adapters = this.adapters();
      return await syncScope({ scope: "p", state: this.scope, transport: this.folder.transport(), adapters, clock: this.clock, device: this.id });
    } finally {
      this.browser = S();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

const act = (fn) => useBrowser.setState(fn(S()), true);
const host = (t) => new URL(t.pinnedUrl || t.url).hostname.replace(".example", "");
const tabOf = (h) => Object.values(S().tabs).find((t) => t.pinned && host(t) === h)?.id;
const area = (device) =>
  device.with(() =>
    Object.values(S().tabs)
      .filter((t) => t.pinned)
      .map((t) => `${host(t)}:${t.pinnedAsRow ? "row" : t.tileFolder ? t.tileFolder.name : "tile"}`)
      .sort(),
  );

function seed(device) {
  device.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [mail, cal, docs, news, row] = ["mail", "cal", "docs", "news", "row"].map(open);
    S().pinTabs([mail, cal, docs, news], true);
    S().pinTabs([row], true, true);
    act((s) => folders.newTileFolder(s, [cal, docs, news], "Work").state);
  });
}

test("the pinned area syncs tile folders, then rows, the row order, pinned groups' None colour and pinned group tabs' homes, then the pins themselves", () => {
  assert.deepEqual(
    pinnedArea.pinnedAreaAdapters("default").map((a) => a.prefix),
    ["tilefold:", "pinrow:", "pord:g:", "pgc:", "pgh:", "pin"],
  );
});

test("a row and tiles in a folder pinned on one Mac arrive on the other as a row and in that folder", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(area(a), ["cal:Work", "docs:Work", "mail:tile", "news:Work", "row:row"]);
  assert.deepEqual(area(b), area(a));
  assert.equal((await a.sync()).published, 0, "settled");
  assert.equal((await b.sync()).published, 0, "settled");
});

test("unpinning a row and a tile in a folder deletes their marks in the same batch as their pins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const [row, docs] = a.with(() => [tabOf("row"), tabOf("docs")]);
  const before = new Set(folder.files.keys());
  a.with(() => S().pinTabs([row, docs], false));
  await a.sync();
  const batches = [...folder.files]
    .filter(([id]) => !before.has(id))
    .map(([, f]) => JSON.parse(f.payload))
    .filter((f) => f.kind === "log")
    .map((f) => new Set(f.ops.filter((op) => op.v === null).map((op) => op.k)));
  const gone = [`pin:t:${row}`, `pinrow:${row}`, `pin:t:${docs}`, `tilefold:${docs}`];
  assert.ok(
    batches.some((deleted) => gone.every((k) => deleted.has(k))),
    `one batch deletes ${gone.join(", ")}`,
  );
  await syncAll([b, a]);
  assert.deepEqual(area(b), ["cal:Work", "mail:tile", "news:Work"]);
  for (const k of gone) assert.equal(b.scope.records[k]?.v, null, `${k} is a tombstone on B`);
});

test("a pin another Mac published under the app's old name arrives with today's", async () => {
  const folder = new Folder();
  const b = new Device("devB", folder);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  const h = new Clock("devOld").tick();
  const value = { g: null, u: "netnyahoo://history", t: null, i: null, ti: "History", pos: "V" };
  folder.files.set("old1", { scope: "p", payload: JSON.stringify({ v: 1, kind: "log", device: "devOld", seq: 1, at: Date.now(), ops: [{ k: "pin:t:oldpin", h, v: value }] }) });
  await b.sync();
  assert.equal(b.with(() => S().tabs.oldpin?.pinnedUrl), "ardia://history");
});

const previousVersion = () => [previous.pinnedRowsAdapter("default"), previous.pinnedAdapter("default")];

const memberOf = (device, key) =>
  device.with(() => {
    const members = new Set(Object.values(S().groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
    return Object.values(S().tabs).find((t) => (t.pinKey ?? t.id) === key && !t.pinned && members.has(t.id));
  });

function seedGroup(device) {
  return device.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const m = S().newTab(w, { url: "https://start.example/", background: true });
    S().groupTabs([m], { pinned: true, name: "Reading" });
    useBrowser.setState((s) => ({ tabs: { ...s.tabs, [m]: { ...s.tabs[m], url: "https://later.example/" } } }));
    return m;
  });
}

test("a pinned group tab's home reaches the other Mac in the pull that brings the tab, and a new home follows", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const m = seedGroup(a);
  assert.equal(a.with(() => S().tabs[m].pinnedUrl), "https://start.example/");
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.equal(memberOf(b, m)?.pinnedUrl, "https://start.example/", "its home, not the page it was on");

  a.with(() => S().setPinnedUrl(m));
  await syncAll([a, b]);
  assert.equal(memberOf(b, m)?.pinnedUrl, "https://later.example/");
  const fromB = [...folder.files.values()]
    .map((f) => JSON.parse(f.payload))
    .filter((f) => f.kind === "log" && f.device === "devB")
    .flatMap((f) => f.ops)
    .filter((op) => op.k.startsWith("pgh:"));
  assert.deepEqual(fromB, [], "B never sends a home of its own over A's");
});

test("a Mac on the previous version keeps the homes it can't read, and its unpin deletes the home on the others", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, previousVersion);
  const m = seedGroup(a);
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  assert.equal(old.scope.records[`pgh:${m}`]?.v, "https://start.example/", "kept in its replica");
  assert.ok(old.scope.unapplied.includes(`pgh:${m}`), "and left unapplied");
  const onOld = memberOf(old, m);
  assert.ok(onOld, "the tab is in its pinned group there");

  old.with(() => S().placeTabs([onOld.id], { pinned: false, beforeId: null }));
  await syncAll([old, a]);
  assert.equal(a.scope.records[`pin:t:${m}`]?.v, null);
  assert.equal(a.scope.records[`pgh:${m}`]?.v, null, "the home goes with the pin");
});

test("a tile moved into a pinned group on another Mac takes the home chosen there, and keeps it", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const [x, group] = a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const id = S().newTab(w, { url: "https://first.example/", background: true });
    S().pinTabs([id], true);
    const mate = S().newTab(w, { url: "https://mate.example/", background: true });
    return [id, S().groupTabs([mate], { pinned: true, name: "Reading" })];
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().tabs[x]?.pinnedUrl), "https://first.example/", "B has the tile");

  a.with(() => {
    S().placeTabs([x], { pinned: false, groupId: group });
    useBrowser.setState((s) => ({ tabs: { ...s.tabs, [x]: { ...s.tabs[x], url: "https://second.example/" } } }));
    S().setPinnedUrl(x);
  });
  assert.equal(a.with(() => S().tabs[x].pinnedUrl), "https://second.example/");
  await syncAll([a, b, a, b]);
  assert.equal(memberOf(b, x)?.pinnedUrl, "https://second.example/", "B takes the home chosen on A");
  assert.equal(memberOf(a, x)?.pinnedUrl, "https://second.example/", "and doesn't send its tile's home back");
});

const LEGACY_GROUP_COLORS = [null, "grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const pinnedGroupOf = (device, name) => device.with(() => Object.values(S().groups).find((g) => g.pinned && g.name === name));

test("a pinned group set to None reaches the other Macs as None, while its pin:g: record keeps a colour older Macs know", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const old = new Device("devOld", folder, previousVersion);
  seedGroup(a);
  const g = pinnedGroupOf(a, "Reading");
  a.with(() => S().updateGroup(g.id, { color: "none" }));
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, b, old]);
  const record = a.scope.records[`pin:g:${g.id}`]?.v;
  assert.ok(record, "the group is published");
  assert.ok(LEGACY_GROUP_COLORS.includes(record.c), `pin:g: carries ${JSON.stringify(record.c)}, which a released top strip can't look up`);
  assert.ok(LEGACY_GROUP_COLORS.includes(pinnedGroupOf(old, "Reading")?.color ?? null), "the older Mac's group has a colour it knows");
  assert.equal(pinnedGroupOf(b, "Reading")?.color, "none", "a current Mac shows None");

  const onOld = pinnedGroupOf(old, "Reading");
  old.with(() => S().updateGroup(onOld.id, { name: "Read later" }));
  await syncAll([old, a, b]);
  assert.equal(pinnedGroupOf(a, "Read later")?.color, "none", "a rename on the older Mac keeps None");
  assert.equal(pinnedGroupOf(b, "Read later")?.color, "none");

  old.with(() => S().updateGroup(onOld.id, { color: "blue" }));
  await syncAll([old, a, b]);
  assert.equal(pinnedGroupOf(a, "Read later")?.color, "blue", "a colour chosen on the older Mac wins");
  assert.equal(pinnedGroupOf(b, "Read later")?.color, "blue");

  b.with(() => S().updateGroup(pinnedGroupOf(b, "Read later").id, { color: "none" }));
  await syncAll([b, a, old]);
  assert.equal(pinnedGroupOf(a, "Read later")?.color, "none", "None chosen again comes back");
  b.with(() => S().updateGroup(pinnedGroupOf(b, "Read later").id, { color: null }));
  await syncAll([b, a, old]);
  assert.equal(pinnedGroupOf(a, "Read later")?.color, null, "and Neutral after it");
});

test("a None group's copy in a second window stays None through a rename from another Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seedGroup(a);
  const g = pinnedGroupOf(a, "Reading");
  a.with(() => S().updateGroup(g.id, { color: "none" }));
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  b.with(() => S().createWindow({ url: "https://b-second.example/" }));
  const copies = () => b.with(() => Object.values(S().groups).filter((x) => x.pinned && (x.pinKey ?? x.id) === g.id));
  assert.equal(copies().length, 2, "each window of B has a copy");
  assert.ok(copies().some((x) => x.id !== g.id), "one with its own id");
  a.with(() => S().updateGroup(g.id, { name: "Read later" }));
  await syncAll([a, b]);
  await syncAll([b, a]);
  assert.deepEqual(copies().map((x) => [x.name, x.color]), [["Read later", "none"], ["Read later", "none"]], "both copies keep None");
  assert.equal(pinnedGroupOf(a, "Read later")?.color, "none", "and None isn't deleted for everyone");
});
