import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const { settingsAdapter, settingsToReapply } = await import("./settingsAdapter.ts");
const pinnedArea = await import("./pinned.ts");
const { pinnedOrderAdapter } = await import("./pinnedOrderAdapter.ts");
const { pinnedRowsAdapter } = await import("./pinnedRowsAdapter.ts");
const stub = await import("../../test-native/index.ts");
const ardiacore = await import("@ardia/ardiacore");

const S = () => useBrowser.getState();

const fakeSeal = (origin, username, password) => Buffer.from(JSON.stringify([origin, username, password])).toString("base64");
const sealedLogins = (read = stub.readLogins) => ({
  read: async () =>
    (await read()).flatMap((l) => {
      const origin = l.origin.replace(/\/$/, "");
      return /^https?:\/\/[^/\s]+$/.test(origin) ? [{ origin, username: l.username, created: l.created, sealed: fakeSeal(origin, l.username, l.password) }] : [];
    }),
  save: async (profile, origin, username, sealed, replacing) => {
    const [o, u, password] = JSON.parse(Buffer.from(sealed, "base64").toString());
    if (o !== origin || u !== username) return false;
    if (replacing && !(await ardiacore.deletePassword(profile, origin, username))) return false;
    return ardiacore.savePassword(profile, origin, username, password);
  },
});

class Folder {
  files = new Map();
  hidden = new Set();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        this.onRead?.();
        const shown = [...this.files].filter(([id, f]) => f.scope === scope && !this.hidden.has(id));
        const files = shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder, { legacy = false, settings } = {}) {
    this.id = id;
    this.folder = folder;
    this.legacy = legacy;
    this.settings = settings;
    S().hydrate({});
    useBrowser.setState({ historyReady: { default: true }, bookmarksReady: { default: true } });
    this.browser = S();
    this.scopes = { app: emptyScope(), p: emptyScope() };
    this.clock = new Clock(id);
    stub.passwordStores.set(id, new Map());
    this.passwords = adapters.passwordsAdapter("default", () => true, sealedLogins());
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
  async sync(profileId = "default", options = {}) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    const run = (scope, list, options) =>
      syncScope({
        scope,
        state: (this.scopes[scope] ??= emptyScope()),
        transport: this.folder.transport(),
        adapters: list,
        clock: this.clock,
        device: this.id,
        options,
      });
    try {
      if (!this.settings) this.scopes.app.unapplied = [...new Set([...this.scopes.app.unapplied, ...settingsToReapply(this.scopes.app.records)])];
      const app = await run("app", [this.settings ?? settingsAdapter]);
      const p = await run(
        profileId === "default" ? "p" : `p:${profileId}`,
        [
          ...(this.legacy ? [] : [pinnedRowsAdapter(profileId), pinnedOrderAdapter(profileId)]),
          pinnedArea.pinnedAdapter(profileId),
          adapters.bookmarksAdapter(profileId),
          adapters.historyAdapter(profileId),
          adapters.deviceTabsAdapter(profileId, this.id, () => `${this.id}'s MacBook Pro`),
          this.passwords,
        ],
        { expired: adapters.historyExpired, ...options },
      );
      return { published: app.published + p.published };
    } finally {
      this.browser = S();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

function tree(device, profileId = "default") {
  return device.with(() => {
    const b = S().bookmarks;
    const roots = b.roots[profileId];
    const walk = (id) => {
      const n = b.nodes[id];
      return n.kind === "url" ? `${n.title}=${n.url}` : { [n.title]: n.children.map(walk) };
    };
    return { bar: walk(roots.bar), other: walk(roots.other) };
  });
}

function assertTreeWhole(device) {
  device.with(() => {
    const b = S().bookmarks;
    for (const n of Object.values(b.nodes)) {
      if (n.parentId) assert.ok(b.nodes[n.parentId]?.children.includes(n.id), `${n.title} is in its parent`);
      if (n.kind === "folder") for (const c of n.children) assert.equal(b.nodes[c]?.parentId, n.id);
    }
  });
}

const OLD_SESSION = (() => {
  const { cmdClickCreatesTabGroup: _c, tabReorderHaptics: _t, chosen: _x, ...rest } = S().settings;
  return { ...rest, cleanUpInactiveTabsAfterHours: null };
})();
const relaunch = (device, settings) =>
  device.with(() => {
    S().hydrate({ settings });
    useBrowser.setState({ historyReady: { default: true }, bookmarksReady: { default: true } });
  });

test("settings: what a Mac only has by default isn't sent; nulls from another Mac are no say; Never and an explicit off apply", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: true, tabReorderHaptics: true, cleanUpInactiveTabsAfterHours: 12 }));
  relaunch(a, OLD_SESSION);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), true, "filled in at launch");
  const extraction = a.with(() => settingsAdapter.extract(() => undefined));
  assert.ok(!extraction.values.has("set:cmdClickCreatesTabGroup") && extraction.ignore("set:cmdClickCreatesTabGroup"), "a default filled in abstains");
  assert.ok(!extraction.values.has("set:cleanUpInactiveTabsAfterHours"), "an old session's Never, its default, never published: no say either");
  const visible = new Map([["set:cmdClickCreatesTabGroup", { v: null }], ["set:tabReorderHaptics", {}], ["set:cleanUpInactiveTabsAfterHours", { v: null }]]);
  b.with(() => settingsAdapter.apply(visible, ["set:cmdClickCreatesTabGroup", "set:tabReorderHaptics", "set:cleanUpInactiveTabsAfterHours"]));
  b.with(() => {
    assert.equal(S().settings.cmdClickCreatesTabGroup, true);
    assert.equal(S().settings.tabReorderHaptics, true);
    assert.equal(S().settings.cleanUpInactiveTabsAfterHours, null, "Never is a value of its own");
  });
  b.with(() => settingsAdapter.apply(new Map([["set:cmdClickCreatesTabGroup", { v: false }]]), ["set:cmdClickCreatesTabGroup"]));
  b.with(() => assert.equal(S().settings.cmdClickCreatesTabGroup, false, "an explicit off is taken"));
});

test("settings: a joined Mac relaunched with a setting it never had doesn't overwrite another Mac's choice; its own reset does", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  a.scopes.app.base["set:cmdClickCreatesTabGroup"] = JSON.stringify({ v: null });
  relaunch(a, OLD_SESSION);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: false }));
  await b.sync();
  await new Promise((r) => setTimeout(r, 20));
  await syncAll([a, b]);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), false);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), false);
  await new Promise((r) => setTimeout(r, 20));
  a.with(() => S().updateSettings({ cmdClickCreatesTabGroup: true }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), true);
  a.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: 12 }));
  await syncAll([a, b]);
  a.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: null }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.cleanUpInactiveTabsAfterHours), null);
});

test("settings: a session a pre-chosen build saved whole (defaults filled in) doesn't count those defaults as choices", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  a.scopes.app.base["set:cmdClickCreatesTabGroup"] = JSON.stringify({ v: null });
  const { chosen: _x, ...whole } = { ...S().settings, cmdClickCreatesTabGroup: true };
  relaunch(a, whole);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: false }));
  await b.sync();
  await new Promise((r) => setTimeout(r, 20));
  await syncAll([a, b]);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), false);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), false);
  await new Promise((r) => setTimeout(r, 20));
  relaunch(a, { ...whole, cmdClickCreatesTabGroup: false, tabReorderHaptics: false });
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.tabReorderHaptics), false);
});

test("settings: a setting from a newer version survives an older Mac's syncs (no deletion)", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  const newer = {
    ...settingsAdapter,
    extract: (base) => {
      const e = settingsAdapter.extract(base);
      e.values.set("set:futureBool", { v: false });
      return { values: e.values, ignore: (k) => !e.values.has(k) };
    },
  };
  stub.current.device = "B";
  useBrowser.setState(b.browser, true);
  await syncScope({ scope: "app", state: b.scopes.app, transport: folder.transport(), adapters: [newer], clock: b.clock, device: "B" });
  b.browser = S();
  for (let i = 0; i < 3; i++) await a.sync();
  assert.deepEqual(a.scopes.app.records["set:futureBool"]?.v, { v: false }, "A keeps it");
  const tombstones = [...folder.files.values()].flatMap((f) => JSON.stringify(f.payload).match(/futureBool[^}]*null/g) ?? []);
  assert.deepEqual(tombstones, [], "and never deletes it");
});

test("bookmarks: a folder deleted on one Mac while the other adds to it keeps the new bookmark", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => S().addBookmarkFolder({ profileId: "default", title: "Trip" }));
  await syncAll([a, b]);
  const trip = (d) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === "Trip")?.id);
  a.with(() => S().removeBookmark(trip(a)));
  b.with(() => S().addBookmark({ profileId: "default", url: "https://hotel.example/", title: "Hotel", parentId: trip(b) }));
  await syncAll([a, b, a]);
  assert.deepEqual(tree(a), tree(b));
  assert.deepEqual(tree(a).other, { "Other Bookmarks": ["Hotel=https://hotel.example/"] });
  assertTreeWhole(a);
  assertTreeWhole(b);
});

test("bookmarks: folders moved into each other on two Macs don't make a cycle", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    S().addBookmarkFolder({ profileId: "default", title: "One" });
    S().addBookmarkFolder({ profileId: "default", title: "Two" });
  });
  await syncAll([a, b]);
  const id = (d, title) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === title).id);
  a.with(() => S().moveBookmark(id(a, "One"), id(a, "Two")));
  b.with(() => S().moveBookmark(id(b, "Two"), id(b, "One")));
  await syncAll([a, b, a, b]);
  assert.deepEqual(tree(a), tree(b));
  assertTreeWhole(a);
  const reachable = JSON.stringify(tree(a));
  assert.ok(reachable.includes("One") && reachable.includes("Two"));
});

test("pinned tabs sync once however many windows show them; a closed window or a parked set deletes nothing elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  let aHome, aWork;
  a.with(() => {
    aHome = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), aHome)[0];
    const cal = S().newTab(aHome, { url: "https://cal.example/" });
    S().pinTabs([mail, cal], true);
    aWork = S().createWindow({ url: "https://work.example/" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const pins = (d) => d.with(() => Object.values(S().tabs).filter((t) => t.pinned).map((t) => t.pinnedUrl).sort());
  assert.deepEqual(pins(a), ["https://cal.example/", "https://cal.example/", "https://mail.example/", "https://mail.example/"], "a copy in each of A's windows");
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "one each on B");

  a.with(() => S().closeWindow(aHome));
  assert.equal(a.with(() => S().parkedPins.default), undefined, "A's other window still shows them: nothing parked");
  await syncAll([a, b]);
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "still pinned on B");

  b.with(() => {
    const [mail, cal] = ["https://mail.example/", "https://cal.example/"].map((u) => Object.values(S().tabs).find((t) => t.pinnedUrl === u).id);
    S().updateTab(mail, { customTitle: "Inbox" });
    S().pinTabs([cal], false);
  });
  await syncAll([b, a]);
  const tiles = (d, w) => d.with(() => model.viewTabIds(S(), w).filter((id) => S().tabs[id].pinned).map((id) => `${S().tabs[id].pinnedUrl} ${S().tabs[id].customTitle}`));
  assert.deepEqual(tiles(a, aWork), ["https://mail.example/ Inbox"]);
  assert.equal((await a.sync()).published, 0, "settled");

  a.with(() => S().closeWindow(aWork));
  assert.equal(a.with(() => S().parkedPins.default.tabs.length), 1);
  b.with(() => S().updateTab(Object.values(S().tabs).find((t) => t.pinned).id, { customTitle: "Mail" }));
  await syncAll([b, a]);
  const n = a.with(() => S().createWindow());
  await syncAll([a]);
  assert.deepEqual(tiles(a, n), ["https://mail.example/ Mail"]);
  assert.equal((await a.sync()).published, 0, "settled");
  const m = a.with(() => S().createWindow());
  assert.deepEqual(tiles(a, m), ["https://mail.example/ Mail"], "and the next window too");
  assert.equal((await a.sync()).published, 0, "copies publish nothing new");
});

const rowsOf = (d) =>
  d.with(() => {
    const w = S().windowOrder.find((id) => !S().windows[id].incognito);
    const ids = model.viewTabIds(S(), w).filter((id) => S().tabs[id].pinned);
    const at = (row) => ids.filter((id) => !!S().tabs[id].pinnedAsRow === row).map((id) => `${S().tabs[id].pinnedUrl}${S().tabs[id].customTitle ? ` ${S().tabs[id].customTitle}` : ""}`);
    return { tiles: at(false), rows: at(true) };
  });

test("pinned rows sync as rows, keep their order, and move between rows and tiles on every Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), w)[0];
    const docs = S().newTab(w, { url: "https://docs.example/" });
    const cal = S().newTab(w, { url: "https://cal.example/" });
    S().pinTabs([mail], true);
    S().pinTabs([docs, cal], true, true);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://mail.example/"], rows: ["https://docs.example/", "https://cal.example/"] });

  b.with(() => {
    const cal = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://cal.example/").id;
    const mail = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://mail.example/").id;
    S().placeTabs([cal], { pinned: true, row: false });
    S().placeTabs([mail], { pinned: true, row: true });
  });
  await syncAll([b, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://cal.example/"], rows: ["https://docs.example/", "https://mail.example/"] });
  assert.equal((await a.sync()).published, 0, "settled");
  assert.equal((await b.sync()).published, 0, "settled");

  const marks = (d) => Object.entries(d.scopes.p.records).filter(([k, r]) => k.startsWith("pinrow:") && r.v === 1).length;
  assert.equal(marks(a), 2);
  a.with(() => S().pinTabs([Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id], false));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://cal.example/"], rows: ["https://mail.example/"] });
  assert.equal(marks(b), 1, "unpinning a row deletes its mark");
});

test("a Mac on an older version sees rows as tiles, and its edits never turn a row into a tile elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), w)[0];
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([mail], true);
    S().pinTabs([docs], true, true);
  });
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  assert.deepEqual(rowsOf(old), { tiles: ["https://mail.example/", "https://docs.example/"], rows: [] }, "the older Mac shows both as tiles");

  old.with(() => {
    const docs = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id;
    S().updateTab(docs, { customTitle: "Docs" });
  });
  await syncAll([old, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://mail.example/"], rows: ["https://docs.example/ Docs"] }, "renamed there, still a row here");
  assert.equal((await old.sync()).published, 0, "the older Mac settles");
  assert.equal((await a.sync()).published, 0);

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  await syncAll([c]);
  assert.deepEqual(rowsOf(c), { tiles: ["https://mail.example/"], rows: ["https://docs.example/ Docs"] }, "a new Mac gets the row");
});

test("a row mark that arrives before its pinned tab still makes a row, and isn't deleted meanwhile", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true);
  });
  await a.sync();
  const pinFiles = [...folder.files.keys()];
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await b.sync();
  b.with(() => S().placeTabs([Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id], { pinned: true, row: true }));
  await b.sync();

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  pinFiles.forEach((id) => folder.hidden.add(id));
  await syncAll([c]);
  assert.deepEqual(rowsOf(c), { tiles: [], rows: [] }, "only B's mark has arrived, not the tab");
  assert.equal((await c.sync()).published, 0, "and C doesn't delete the mark of a tab it hasn't seen");
  folder.hidden.clear();
  await syncAll([c, a, b]);
  for (const d of [a, b, c]) assert.deepEqual(rowsOf(d), { tiles: [], rows: ["https://docs.example/"] });
});

const later = () => new Promise((r) => setTimeout(r, 5));
const tabAt = (url) => Object.values(S().tabs).find((t) => t.url === url || t.pinnedUrl === url)?.id;

test("a tab kept open after an unpin and pinned again as a row elsewhere comes back as a row", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().activate(docs);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  b.with(() => S().activate(tabAt("https://docs.example/")));
  await later();
  a.with(() => S().pinTabs([tabAt("https://docs.example/")], false));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().tabs[tabAt("https://docs.example/")].pinned), false, "B keeps its open copy as a regular tab");
  await later();
  a.with(() => S().pinTabs([tabAt("https://docs.example/")], true, true));
  await syncAll([a, b, a, b]);
  assert.deepEqual(rowsOf(b).rows, ["https://docs.example/"], "B pins it again as a row");
  assert.deepEqual(rowsOf(a).rows, ["https://docs.example/"], "and A keeps its row");
});

test("a mirrored row kept open after a local unpin is the tab another Mac's re-pin takes back", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  let x;
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    x = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([x], true, true);
  });
  let b1;
  b.with(() => (b1 = S().createWindow({ url: "https://b-home.example/" })));
  await syncAll([a, b]);
  b.with(() => {
    const b2 = S().createWindow({ url: "https://b-two.example/" });
    const copy = S().windows[b2].tabIds.find((id) => S().tabs[id].pinnedUrl === "https://docs.example/");
    assert.ok(copy && S().tabs[copy].pinKey, "B's second window has its own copy of the row");
    S().activate(copy);
    useBrowser.setState((s) => ({ tabs: { ...s.tabs, [copy]: { ...s.tabs[copy], navigation: { url: "https://docs.example/", seq: 1 } } } }));
    S().closeWindow(b1);
    S().pinTabs([copy], false);
  });
  await syncAll([b, a]);
  assert.deepEqual(rowsOf(a), { tiles: [], rows: [] }, "A sees the unpin");
  await later();
  a.with(() => S().pinTabs([tabAt("https://docs.example/")], true, true));
  await syncAll([a, b, a, b]);
  const docs = b.with(() => Object.values(S().tabs).filter((t) => t.url === "https://docs.example/" || t.pinnedUrl === "https://docs.example/"));
  assert.equal(docs.length, 1, "one tab for the page on B, not an unloaded row beside it");
  assert.equal(docs[0].pinned && docs[0].pinnedAsRow, true, "and it is the row again");
  assert.ok(docs[0].navigation, "with its page");
});

for (const row of [true, false]) {
  test(`a page kept open after a local unpin and put in a regular group leaves the group when another Mac pins it again as a ${row ? "row" : "tile"}`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    let x;
    a.with(() => {
      const w = S().createWindow({ url: "https://home.example/" });
      x = S().newTab(w, { url: "https://docs.example/" });
      S().pinTabs([x], true, row);
    });
    let b1;
    b.with(() => (b1 = S().createWindow({ url: "https://b-home.example/" })));
    await syncAll([a, b]);
    let copy, mates;
    b.with(() => {
      const b2 = S().createWindow({ url: "https://b-two.example/" });
      copy = S().windows[b2].tabIds.find((id) => S().tabs[id].pinnedUrl === "https://docs.example/");
      S().activate(copy);
      useBrowser.setState((s) => ({ tabs: { ...s.tabs, [copy]: { ...s.tabs[copy], navigation: { url: "https://docs.example/", seq: 1 } } } }));
      S().closeWindow(b1);
      S().pinTabs([copy], false);
      const other = S().newTab(b2, { url: "https://mate.example/" });
      mates = S().groupTabs([copy, other], { pinned: false, name: "Reading" });
    });
    await syncAll([b, a]);
    await later();
    a.with(() => S().pinTabs([tabAt("https://docs.example/")], true, row));
    await syncAll([a, b, a, b]);
    b.with(() => {
      const t = S().tabs[copy];
      assert.equal(t.pinned, true, "B pins its open page again");
      assert.equal(!!t.pinnedAsRow, row);
      assert.ok(!Object.values(S().groups).some((g) => g.tabIds.includes(copy)), "and takes it out of its regular group");
      assert.deepEqual(S().groups[mates]?.tabIds.map((id) => S().tabs[id].url), ["https://mate.example/"], "which keeps its other tab");
    });
    b.with(() => S().closeGroup(mates));
    await syncAll([b, a, b]);
    assert.equal(a.with(() => S().tabs[tabAt("https://docs.example/")]?.pinned), true, "closing that group on B leaves A's pin alone");
  });
}

for (const fresh of [false, true]) {
  test(`a ${fresh ? "new tab" : "pin"} added to a pinned group while another Mac unpins that group stays pinned on both`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    let aw, group;
    a.with(() => {
      aw = S().createWindow({ url: "https://home.example/" });
      group = S().groupTabs([S().newTab(aw, { url: "https://one.example/" })], { pinned: true, name: "Team" });
      if (!fresh) S().pinTabs([S().newTab(aw, { url: "https://z.example/" })], true);
    });
    b.with(() => S().createWindow({ url: "https://b-home.example/" }));
    await syncAll([a, b]);
    await later();
    a.with(() => {
      const z = fresh ? S().newTab(aw, { url: "https://z.example/" }) : tabAt("https://z.example/");
      S().placeTabs([z], { pinned: false, groupId: group });
    });
    b.with(() => S().moveGroup(Object.values(S().groups).find((g) => g.name === "Team").id, { pinned: false }));
    const zPinned = (d) => d.with(() => Object.values(S().tabs).filter((t) => (t.url === "https://z.example/" || t.pinnedUrl === "https://z.example/") && t.pinned).length);
    await a.sync();
    await b.sync();
    assert.equal(zPinned(b), 1, "B, whose group is no longer pinned, keeps the page as a standalone pin at once");
    await b.sync();
    await a.sync();
    await syncAll([a, b]);
    assert.equal(zPinned(b), 1, "B has the page as a pin");
    assert.equal(zPinned(a), 1, "and A keeps its pin");
    assert.ok(b.with(() => !Object.values(S().groups).some((g) => g.tabIds.some((id) => S().tabs[id].pinned))), "out of B's regular group");
    assert.equal((await b.sync()).published + (await a.sync()).published, 0, "settled");
  });
}

test("a deletion from another Mac applied after a pin removal here takes the removal's Undo away", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const tab = S().newTab(w, { url: "https://one.example/", background: true });
  const group = S().groupTabs([tab], { pinned: true, name: "Team" });
  const pinKey = S().tabs[tab].pinKey ?? tab;
  S().closeTab(tab);
  const removed = S().removeClosedPin(tab);
  assert.ok(removed);
  pinnedArea.pinnedAdapter("default").apply(new Map(), new Set([`pin:t:${pinKey}`, `pin:g:${group}`]), () => undefined, { known: () => true, now: Date.now(), horizon: 0, joined: true });
  S().undoClearTabs(removed);
  assert.equal(Object.values(S().groups).some((g) => g.name === "Team"), false, "Undo does nothing");
});

test("a row mark held up in transit doesn't undo a later choice of a tile on another Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    S().pinTabs([S().newTab(w, { url: "https://docs.example/" })], true);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await a.sync();
  await b.sync();
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  const delayed = [...folder.files.keys()].filter((id) => !before.has(id));
  delayed.forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
  });
  await b.sync();
  await later();
  b.with(() => S().pinTabs([tabAt("https://docs.example/")], true));
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] }, "and A follows it");
});

test("an unpin and pin as a tile before the next sync still outranks an older row mark in transit", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().placeTabs([docs], { pinned: true, row: false });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b).tiles, ["https://docs.example/"]);
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
    S().pinTabs([docs], true);
  });
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
  assert.deepEqual(b.with(() => S().pinChoices), {}, "the published choice is settled");
  assert.equal((await b.sync()).published + (await a.sync()).published, 0, "and nothing is sent again");
});

for (const [how, move] of [
  ["parked with the last window", (w) => (S().closeWindow(w), S().createWindow({ url: "https://b-next.example/" }))],
  ["left in a closed window while another mirrors it", (w) => (S().createWindow({ url: "https://b-next.example/" }), S().closeWindow(w))],
]) {
  test(`a tile chosen before the next sync outranks an older row mark when the choice was ${how}`, async () => {
    const folder = new Folder();
    const old = new Device("devOld", folder, { legacy: true });
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    old.with(() => {
      const w = S().createWindow({ url: "https://old-home.example/" });
      S().pinTabs([S().newTab(w, { url: "https://docs.example/" })], true);
    });
    a.with(() => S().createWindow({ url: "https://a-home.example/" }));
    let bw;
    b.with(() => (bw = S().createWindow({ url: "https://b-home.example/" })));
    await syncAll([old, a, b]);
    await later();
    const before = new Set(folder.files.keys());
    a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
    await a.sync();
    [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
    await later();
    b.with(() => {
      const docs = tabAt("https://docs.example/");
      S().activate(docs);
      S().pinTabs([docs], false);
    });
    await b.sync();
    await later();
    b.with(() => {
      S().pinTabs([tabAt("https://docs.example/")], true);
      move(bw);
    });
    await b.sync();
    folder.hidden.clear();
    await syncAll([b, a, b, a]);
    assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
    assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
  });
}

async function tileWithMarkOnBoth() {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().placeTabs([docs], { pinned: true, row: false });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
    S().pinTabs([docs], true);
  });
  return { folder, a, b };
}

test("a tile choice whose batch never reached the disk survives a crash and still outranks an older row mark", async () => {
  const { folder, a, b } = await tileWithMarkOnBoth();
  const durable = structuredClone(b.scopes.p);
  await assert.rejects(b.sync("default", { persist: async () => { throw new Error("disk full"); } }));
  assert.equal(Object.keys(b.with(() => S().pinChoices.default ?? {})).filter((k) => !k.includes(":")).length, 1, "the choice stays pending until its batch is on disk");
  b.scopes.p = durable;
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
});

test("a tile choice whose journal write failed is sent once when the write is retried", async () => {
  const { folder, a, b } = await tileWithMarkOnBoth();
  await assert.rejects(b.sync("default", { persist: async () => { throw new Error("disk full"); } }));
  const marks = () => b.scopes.p.journal?.flatMap((f) => f.ops).filter((op) => op.k.startsWith("pinrow:")).length ?? 0;
  assert.equal(marks(), 1);
  await b.sync();
  assert.equal(marks(), 0, "the held batch is written");
  assert.deepEqual(b.with(() => S().pinChoices), {}, "and the choice settles");
  assert.equal((await b.sync()).published, 0, "nothing more is sent");
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
});

const pinnedGroupMembers = (d, profileId, ordered = false) =>
  d.with(() => {
    const order = (urls) => (ordered ? urls : urls.sort());
    const live = Object.values(S().groups).filter((g) => g.pinned && g.profileId === profileId).map((g) => [g.name, order(g.tabIds.map((id) => S().tabs[id].url))]);
    const park = S().parkedPins[profileId];
    const parked = (park?.groups ?? []).map((g) => [g.name, order(park.tabs.filter((t) => t.groupId === g.id).map((t) => t.url))]);
    return [...live, ...parked];
  });

const withWork = (d) =>
  d.with(() =>
    useBrowser.setState((s) => ({
      profiles: { ...s.profiles, work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 } },
      profileOrder: [...s.profileOrder, "work"],
      historyReady: { ...s.historyReady, work: true },
      bookmarksReady: { ...s.bookmarksReady, work: true },
    })),
  );
const pinsIn = (d, profileId) =>
  d.with(() =>
    [
      ...Object.values(S().tabs).filter((t) => t.pinned && t.profileId === profileId),
      ...(S().parkedPins[profileId]?.tabs ?? []).filter((t) => !t.groupId),
    ].map((t) => `${t.pinnedUrl}${t.pinnedAsRow ? " row" : ""}`).sort(),
  );

test("a pin moved to another profile keeps its key there without touching the other profile's pin of the same key", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  withWork(a);
  withWork(b);
  let x;
  a.with(() => {
    const w1 = S().createWindow({ url: "https://docs.example/" });
    x = S().windows[w1].tabIds[0];
    S().pinTabs([x], true, true);
    S().createWindow({ url: "https://home.example/" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinsIn(b, "default"), ["https://docs.example/ row"]);
  a.with(() => S().moveTabToProfile(x, "work"));
  assert.deepEqual(pinsIn(a, "default"), ["https://docs.example/ row"], "A's other Personal window keeps its pin");
  assert.deepEqual(pinsIn(a, "work"), ["https://docs.example/ row"]);
  for (const d of [a, b, b, a]) await d.sync("work");
  for (const d of [a, b]) await d.sync();
  assert.deepEqual({ a: pinsIn(a, "work"), b: pinsIn(b, "work") }, { a: ["https://docs.example/ row"], b: ["https://docs.example/ row"] }, "B gets the Work pin and doesn't delete A's");
  assert.deepEqual(pinsIn(b, "default"), ["https://docs.example/ row"], "B's Personal pin is untouched");
  assert.deepEqual(pinsIn(a, "default"), ["https://docs.example/ row"]);
  assert.equal((await b.sync("work")).published + (await a.sync("work")).published, 0, "settled");
});

test("a pinned group whose key is another profile's group there lands as its own group", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  withWork(a);
  withWork(b);
  let g, docs;
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    docs = S().newTab(w, { url: "https://docs.example/" });
    g = S().groupTabs([docs], { pinned: true, name: "Docs" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const groupsIn = (d, profileId) => pinnedGroupMembers(d, profileId).map(([name, urls]) => `${name}:${urls.join(",")}`);
  assert.deepEqual(groupsIn(b, "default"), ["Docs:https://docs.example/"]);
  a.with(() => useBrowser.setState((s) => ({
    groups: { ...s.groups, [g]: { ...s.groups[g], profileId: "work" } },
    tabs: { ...s.tabs, [docs]: { ...s.tabs[docs], profileId: "work" } },
  })));
  for (const d of [a, b, b, a]) await d.sync("work");
  assert.deepEqual({ a: groupsIn(a, "work"), b: groupsIn(b, "work") }, { a: ["Docs:https://docs.example/"], b: ["Docs:https://docs.example/"] });
  assert.deepEqual(groupsIn(b, "default"), ["Docs:https://docs.example/"], "B's Personal group is untouched");
  assert.equal((await b.sync("work")).published + (await a.sync("work")).published, 0, "settled");
});

for (const [parkedOn, row] of [["the receiving Mac", false], ["both Macs", false], ["the receiving Mac", true]]) {
  test(`a ${row ? "pinned row" : "pin"} moved into a pinned group that is parked on ${parkedOn} stays in the group, and nothing is deleted`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    withWork(a);
    withWork(b);
    let group, aw;
    a.with(() => {
      aw = S().createWindow({ profileId: "work", url: "https://work-home.example/" });
      const m1 = S().newTab(aw, { url: "https://one.example/" });
      group = S().groupTabs([m1], { pinned: true, name: "Team" });
      S().createWindow({ url: "https://home.example/" });
    });
    let bw;
    b.with(() => {
      bw = S().createWindow({ profileId: "work", url: "https://b-work.example/" });
      S().createWindow({ url: "https://b-home.example/" });
    });
    for (const d of [a, b, a, b]) await d.sync("work");
    assert.deepEqual(pinnedGroupMembers(b, "work"), [["Team", ["https://one.example/"]]]);
    b.with(() => S().closeWindow(bw));
    if (parkedOn === "both Macs") a.with(() => S().closeWindow(aw));
    assert.ok(b.with(() => S().parkedPins.work?.groups.length), "B parked Work's group");
    let p2;
    a.with(() => {
      const w = S().windowOrder.find((id) => S().windows[id].profileId === "work") ?? S().createWindow({ profileId: "work", url: "https://work-again.example/" });
      aw = w;
      p2 = S().newTab(w, { url: "https://two.example/" });
      S().pinTabs([p2], true, row);
    });
    for (const d of [a, b, b, a]) await d.sync("work");
    a.with(() => S().placeTabs([p2], { pinned: false, groupId: Object.values(S().groups).find((g) => g.pinned && g.profileId === "work" && g.name === "Team").id }));
    for (const d of [a, b]) await d.sync("work");
    assert.equal((await b.sync("work")).published, 0, "B publishes no tombstone");
    await a.sync("work");
    assert.deepEqual(pinnedGroupMembers(b, "work"), [["Team", ["https://one.example/", "https://two.example/"]]], "B keeps both members");
    assert.deepEqual(pinnedGroupMembers(a, "work"), [["Team", ["https://one.example/", "https://two.example/"]]], "and so does A");
  });
}

test("a parked pin moved into a pinned group that is live in a window joins it there", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  withWork(a);
  withWork(b);
  let aw, p3;
  a.with(() => {
    aw = S().createWindow({ profileId: "work", url: "https://work-home.example/" });
    S().groupTabs([S().newTab(aw, { url: "https://one.example/" })], { pinned: true, name: "Team" });
    p3 = S().newTab(aw, { url: "https://three.example/" });
    S().pinTabs([p3], true);
  });
  b.with(() => S().createWindow({ profileId: "work", url: "https://b-work.example/" }));
  for (const d of [a, b, a, b]) await d.sync("work");
  b.with(() =>
    useBrowser.setState((s) => {
      const t = Object.values(s.tabs).find((x) => x.pinnedUrl === "https://three.example/");
      const w = s.windows[t.windowId];
      const { [t.id]: _, ...tabs } = s.tabs;
      return {
        tabs,
        windows: { ...s.windows, [w.id]: { ...w, tabIds: w.tabIds.filter((id) => id !== t.id) } },
        parkedPins: { ...s.parkedPins, work: { tabs: [{ ...model.snapshotTab(t), id: t.pinKey ?? t.id, groupId: null }], groups: [] } },
      };
    }),
  );
  a.with(() => S().placeTabs([p3], { pinned: false, groupId: Object.values(S().groups).find((g) => g.pinned && g.name === "Team").id }));
  for (const d of [a, b]) await d.sync("work");
  assert.equal((await b.sync("work")).published, 0, "B publishes no tombstone");
  await a.sync("work");
  assert.deepEqual(pinnedGroupMembers(b, "work"), [["Team", ["https://one.example/", "https://three.example/"]]]);
  assert.deepEqual(pinnedGroupMembers(a, "work"), [["Team", ["https://one.example/", "https://three.example/"]]]);
  assert.ok(b.with(() => { const g = Object.values(S().groups).find((x) => x.name === "Team"); return g.tabIds.every((id) => S().tabs[id].windowId === g.windowId); }), "members live in the group's window");
});

const windowsWhole = (d) =>
  d.with(() => {
    const s = S();
    for (const w of Object.values(s.windows)) {
      assert.ok(w.tabIds.length, `window ${w.id} has tabs`);
      for (const id of w.tabIds) assert.equal(s.tabs[id]?.windowId, w.id, `${id} belongs to ${w.id}`);
      for (const [p, id] of Object.entries(w.activeTabIds)) assert.equal(s.tabs[id]?.windowId, w.id, `${w.id}'s active ${p} tab is in it`);
    }
    for (const v of Object.values(s.splits)) for (const id of v.tabIds) assert.equal(s.tabs[id]?.windowId, v.windowId, `split ${v.id} keeps ${id} in its window`);
    for (const g of Object.values(s.groups)) for (const id of g.tabIds) assert.equal(s.tabs[id]?.windowId, g.windowId, `group ${g.name} keeps ${id} in its window`);
  });

for (const split of [false, true]) {
  test(`a page open in one window that another Mac puts in a pinned group stays in its window${split ? ", split included" : ""}`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    let x;
    a.with(() => {
      const w = S().createWindow({ url: "https://home.example/" });
      x = S().newTab(w, { url: "https://x.example/" });
      S().pinTabs([x], true);
    });
    let b1;
    b.with(() => (b1 = S().createWindow({ url: "https://b-home.example/" })));
    await syncAll([a, b]);
    b.with(() => {
      const bx = tabAt("https://x.example/");
      S().activate(bx);
      useBrowser.setState((s) => ({ tabs: { ...s.tabs, [bx]: { ...s.tabs[bx], navigation: { url: "https://x.example/", seq: 1 } } } }));
    });
    a.with(() => S().pinTabs([x], false));
    await syncAll([a, b]);
    b.with(() => {
      const bx = tabAt("https://x.example/");
      assert.equal(S().tabs[bx].pinned, false, "B keeps its open page as a regular tab");
      const other = S().windows[b1].tabIds.find((id) => id !== bx);
      if (split) S().createSplit([bx, other]);
      else S().closeTab(other);
      S().createWindow({ url: "https://b-two.example/" });
    });
    await later();
    a.with(() => S().groupTabs([x], { pinned: true, name: "Team" }));
    await syncAll([a, b]);
    windowsWhole(b);
    assert.equal(b.with(() => S().tabs[tabAt("https://x.example/")]?.windowId), b1, "the open page stays in its window");
    assert.ok(pinnedGroupMembers(b, "default").some(([name, urls]) => name === "Team" && urls.includes("https://x.example/")), "and B has the group with it");
    assert.equal((await b.sync()).published + (await a.sync()).published, 0, "settled");
    assert.deepEqual(pinnedGroupMembers(a, "default"), [["Team", ["https://x.example/"]]]);
  });
}

test("a pinned group whose members are open in two windows of a Mac keeps both pages where they are", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  let x, y;
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    x = S().newTab(w, { url: "https://x.example/" });
    y = S().newTab(w, { url: "https://y.example/" });
    S().pinTabs([x, y], true);
  });
  let b1, b2;
  b.with(() => (b1 = S().createWindow({ url: "https://b-home.example/" })));
  await syncAll([a, b]);
  const open = (url) => {
    const id = tabAt(url);
    useBrowser.setState((s) => ({ tabs: { ...s.tabs, [id]: { ...s.tabs[id], navigation: { url, seq: 1 } } } }));
    return id;
  };
  b.with(() => {
    open("https://x.example/");
    b2 = S().createWindow({ url: "https://b-two.example/" });
    const yb2 = S().windows[b2].tabIds.find((id) => S().tabs[id].pinnedUrl === "https://y.example/");
    useBrowser.setState((s) => ({ tabs: { ...s.tabs, [yb2]: { ...s.tabs[yb2], navigation: { url: "https://y.example/", seq: 1 } } } }));
  });
  a.with(() => S().pinTabs([x, y], false));
  await syncAll([a, b]);
  await later();
  a.with(() => S().groupTabs([x, y], { pinned: true, name: "Team" }));
  await a.sync();
  assert.deepEqual(pinnedGroupMembers(a, "default", true), [["Team", ["https://x.example/", "https://y.example/"]]]);
  await b.sync();
  assert.ok(pinnedGroupMembers(b, "default", true).every(([, urls]) => urls.join() === "https://x.example/,https://y.example/"), JSON.stringify(pinnedGroupMembers(b, "default", true)));
  assert.equal((await b.sync()).published, 0, "B sends nothing back after receiving the group");
  assert.equal((await b.sync()).published, 0, "nor on its next sync");
  await syncAll([a, b]);
  assert.deepEqual(pinnedGroupMembers(a, "default", true), [["Team", ["https://x.example/", "https://y.example/"]]], "A keeps its order");
  windowsWhole(b);
  const pages = b.with(() => Object.values(S().tabs).filter((t) => t.navigation).map((t) => `${t.url}@${t.windowId === b1 ? "b1" : t.windowId === b2 ? "b2" : "?"}`).sort());
  assert.ok(pages.includes("https://x.example/@b1") && pages.includes("https://y.example/@b2"), JSON.stringify(pages));
  assert.ok(pinnedGroupMembers(b, "default").every(([name, urls]) => name === "Team" && urls.join() === "https://x.example/,https://y.example/"));
  assert.equal((await b.sync()).published + (await a.sync()).published + (await b.sync()).published, 0, "settled");
  assert.deepEqual(pinnedGroupMembers(a, "default"), [["Team", ["https://x.example/", "https://y.example/"]]]);
});

test("passwords: saved on one Mac, changed or deleted on another; the newer edit of a login wins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const save = (d, origin, user, password) => d.with(() => ardiacore.savePassword("", origin, user, password));
  const remove = (d, origin, user) => d.with(() => ardiacore.deletePassword("", origin, user));
  const list = (d) => [...stub.passwordStores.get(d.id).values()].map((l) => `${l.url} ${l.username}=${l.password}`).sort();
  await save(a, "https://bank.example", "alice", "hunter2");
  await save(a, "https://mail.example", "alice", "m41l");
  await save(b, "https://shop.example", "bob", "sh0p");
  await syncAll([a, b]);
  assert.deepEqual(list(a), list(b));
  assert.deepEqual(list(b), ["https://bank.example alice=hunter2", "https://mail.example alice=m41l", "https://shop.example bob=sh0p"]);
  await save(b, "https://bank.example", "alice", "correct horse");
  await remove(b, "https://mail.example", "alice");
  await syncAll([b, a]);
  assert.deepEqual(list(a), ["https://bank.example alice=correct horse", "https://shop.example bob=sh0p"]);
  assert.equal((await a.sync()).published, 0);
  for (const d of [a, b]) assert.ok(!JSON.stringify(d.scopes.p).includes("correct horse"), "the sync state holds only sealed passwords");
});

test("history: two Macs settle on the union of their visits in Chrome, publish nothing more, and deletions reach Chrome", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  for (const d of [a, b]) stub.historyDbs.delete(d.id);
  const readChrome = async (d) => {
    stub.current.device = d.id;
    const entries = await ardiacore.queryHistory("");
    d.with(() =>
      useBrowser.setState({
        history: { default: entries.map((e) => ({ ...e, favicon: null, lastVisit: e.visitTimes.at(-1) })) },
        historyReady: { default: true },
      }),
    );
  };
  const sync = async (d) => {
    await readChrome(d);
    return d.sync();
  };
  const visits = (d, url) => stub.historyDbs.get(d.id)?.get("")?.get(url)?.visits ?? [];
  const t = Date.now() - 3_600_000;
  const visit = (d, url, at) => d.with(() => ((stub.current.device = d.id), stub.chromeVisit("", url, url, at)));
  visit(a, "https://x.example/", t);
  visit(a, "https://x.example/", t + 1000);
  visit(b, "https://x.example/", t + 2000);
  visit(b, "https://y.example/", t + 3000);
  for (let i = 0; i < 3; i++) for (const d of [a, b]) await sync(d);
  assert.deepEqual(visits(a, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(b, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(a, "https://y.example/"), [t + 3000]);
  assert.equal((await sync(a)).published, 0, "settled on A");
  assert.equal((await sync(b)).published, 0, "settled on B");

  visit(b, "https://x.example/", t + 5000);
  await sync(b);
  await sync(a);
  assert.deepEqual(visits(a, "https://x.example/").at(-1), t + 5000, "a new visit is an edit");

  a.with(() => S().removeHistory("default", ["https://y.example/"]));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(visits(a, "https://y.example/"), []);
  await sync(a);
  await sync(b);
  assert.deepEqual(visits(b, "https://y.example/"), [], "deleted from B's Chrome");
  assert.equal((await sync(a)).published, 0);
  assert.equal((await sync(b)).published, 0);
});

test("bookmarks: a Mac on old ids and one on Chrome's UUIDs keep one tree", async () => {
  const { bookmarkUuidFor } = await import("../bookmarks/bookmarks.ts");
  const folder = new Folder();
  const old = new Device("devOld", folder);
  const now = new Device("devNew", folder);
  old.with(() => {
    const roots = { bar: "bm-bar", other: "bm-other" };
    const n = (id, parentId, x) => ({ id, parentId, addedAt: 5, ...x });
    S().hydrate({
      bookmarks: {
        roots: { default: roots },
        nodes: {
          "bm-bar": n("bm-bar", null, { kind: "folder", title: "Bookmarks Bar", children: ["bm-f"] }),
          "bm-other": n("bm-other", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
          "bm-f": n("bm-f", "bm-bar", { kind: "folder", title: "F", children: ["bm-a", "bm-b"] }),
          "bm-a": n("bm-a", "bm-f", { kind: "url", title: "A", url: "https://a.example/", favicon: null }),
          "bm-b": n("bm-b", "bm-f", { kind: "url", title: "B", url: "https://b.example/", favicon: null }),
        },
      },
    });
  });
  await old.sync();
  now.with(() => {
    S().hydrate({ bookmarks: { nodes: {}, roots: {} } });
    useBrowser.setState({ bookmarksReady: { default: true } });
    const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
    const a = S().addBookmark({ profileId: "default", url: "https://a.example/", title: "A", parentId: f });
    const b = S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B", parentId: f });
    const nodes = { ...S().bookmarks.nodes };
    const rename = (id, legacy) => {
      const node = { ...nodes[id], id: bookmarkUuidFor(legacy), syncKey: legacy, addedAt: 5 };
      delete nodes[id];
      nodes[node.id] = node;
    };
    rename(f, "bm-f");
    rename(a, "bm-a");
    rename(b, "bm-b");
    const uf = bookmarkUuidFor("bm-f");
    nodes[uf] = { ...nodes[uf], children: [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")] };
    for (const id of [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")]) nodes[id] = { ...nodes[id], parentId: uf };
    const bar = S().bookmarks.roots.default.bar;
    nodes[bar] = { ...nodes[bar], children: [uf] };
    useBrowser.setState({ bookmarks: { ...S().bookmarks, nodes } });
  });
  await syncAll([now, old]);
  assert.deepEqual(tree(now), tree(old));
  assert.equal(now.with(() => Object.keys(S().bookmarks.nodes).length), 5, "no duplicates on the updated Mac");
  assert.equal(old.with(() => Object.keys(S().bookmarks.nodes).length), 5, "nor on the old one");
  assert.equal((await now.sync()).published, 0, "the updated Mac republishes nothing");

  const onOld = (key) => old.with(() => Object.values(S().bookmarks.nodes).find((n) => (n.syncKey ?? n.id) === key).id);
  old.with(() => S().updateBookmark(onOld("bm-a"), { title: "A, renamed" }));
  now.with(() => S().addBookmark({ profileId: "default", url: "https://c.example/", title: "C", parentId: bookmarkUuidFor("bm-f") }));
  await syncAll([old, now]);
  assert.deepEqual(tree(now), tree(old));
  assert.deepEqual(tree(now).bar, { "Bookmarks Bar": [{ F: ["A, renamed=https://a.example/", "B=https://b.example/", "C=https://c.example/"] }] });
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-a")]?.title), "A, renamed");
  old.with(() => S().removeBookmark(onOld("bm-b")));
  await syncAll([old, now]);
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-b")]), undefined, "a deletion on the old Mac reaches the UUID node");
  assertTreeWhole(now);
  assertTreeWhole(old);
});

const pinHost = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".example", "");
const pinnedAreaOf = (d, w) =>
  d.with(() => {
    const s = S();
    const depth = (g) => (g.parentId && s.groups[g.parentId] ? 1 + depth(s.groups[g.parentId]) : 0);
    const path = (g) => (g.parentId && s.groups[g.parentId] ? `${path(s.groups[g.parentId])}/${g.name}` : g.name);
    const win = w ?? Object.values(s.windows).find((x) => x.profileId === "default").id;
    return model.viewTabIds(s, win).filter((id) => model.inPinnedContainer(s, id)).map((id) => {
      const t = s.tabs[id];
      if (t.pinned) return `${t.pinnedAsRow ? "row" : "tile"}:${pinHost(id)}`;
      const g = Object.values(s.groups).filter((x) => x.tabIds.includes(id)).sort((a, z) => depth(z) - depth(a))[0];
      return `${path(g)}:${pinHost(id)}`;
    });
  });

function buildPinnedTree(d) {
  return d.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [tile, r1, o1, i1, i2, o2, r2, x] = ["tile", "r1", "o1", "i1", "i2", "o2", "r2", "x"].map(open);
    S().pinTabs([tile], true);
    S().pinTabs([r1], true, true);
    const outer = S().groupTabs([o1, i1, i2, o2], { pinned: true, name: "Outer" });
    const inner = S().groupTabs([i1, i2], { name: "Inner" });
    S().pinTabs([r2], true, true);
    S().groupTabs([x], { pinned: true, name: "Other" });
    S().placeTabs([r2], { pinned: true, row: true, beforeId: x });
    return { w, outer, inner };
  });
}

const PIN_TREE = ["tile:tile", "row:r1", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer:o2", "row:r2", "Other:x"];

test("nested pinned groups sync with their nesting and the order of rows between groups, both ways", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { outer, inner } = buildPinnedTree(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinnedAreaOf(a), PIN_TREE);
  assert.deepEqual(pinnedAreaOf(b), PIN_TREE);
  assert.equal(a.scopes.p.records[`pinn:g:${inner}`]?.v.p, outer, "the nested group names its parent, in a record older Macs don't read");
  assert.equal(a.scopes.p.records[`pin:g:${inner}`], undefined, "older Macs see no nested group");
  assert.deepEqual(Object.keys(a.scopes.p.records[`pin:g:${outer}`].v).sort(), ["c", "i", "n", "pos"], "a root group's record is shaped as before");
  b.with(() => {
    const groupNamed = (n) => Object.values(S().groups).find((g) => g.name === n);
    assert.equal(groupNamed("Inner").parentId, groupNamed("Outer").id);
    const r2 = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://r2.example/").id;
    S().placeTabs([r2], { pinned: true, row: true, beforeId: groupNamed("Outer").tabIds[0] });
    const o2 = groupNamed("Outer").tabIds.find((id) => pinHost(id) === "o2");
    S().placeTabs([o2], { pinned: false, groupId: groupNamed("Inner").id, beforeId: null });
  });
  const moved = ["tile:tile", "row:r1", "row:r2", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer/Inner:o2", "Other:x"];
  assert.deepEqual(pinnedAreaOf(b), moved);
  await syncAll([b, a]);
  assert.deepEqual(pinnedAreaOf(a), moved, "A follows the row moved between groups and the tab moved into the nested group");
  assert.equal((await a.sync()).published + (await b.sync()).published, 0, "settled");
  b.with(() => {
    const at = (url) => Object.values(S().tabs).find((t) => t.pinnedUrl === url).id;
    S().placeTabs([at("https://r2.example/")], { pinned: true, row: true, beforeId: at("https://r1.example/") });
  });
  const swapped = ["tile:tile", "row:r2", "row:r1", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer/Inner:o2", "Other:x"];
  await syncAll([b, a]);
  assert.deepEqual(pinnedAreaOf(a), swapped, "A follows a row moved among rows");
});

test("a parked nested pinned group syncs and comes back nested", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { w } = buildPinnedTree(a);
  a.with(() => S().closeWindow(w));
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinnedAreaOf(b), PIN_TREE);
  const nw = a.with(() => S().createWindow({ url: "https://again.example/" }));
  assert.deepEqual(pinnedAreaOf(a, nw), PIN_TREE);
  await syncAll([a, b]);
  assert.deepEqual(pinnedAreaOf(a, nw), PIN_TREE);
  assert.deepEqual(pinnedAreaOf(b), PIN_TREE);
  assert.equal((await a.sync()).published + (await b.sync()).published, 0, "settled");
});

test("a pinned group record without a parent, as older versions write it, loads as a root group", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  a.with(() => S().createWindow({ url: "https://home.example/" }));
  await a.sync();
  const clock = new Clock("devOld");
  await syncScope({
    scope: "p",
    state: emptyScope(),
    transport: folder.transport(),
    adapters: [
      {
        prefix: "pin:",
        extract: () => ({
          values: new Map([
            ["pin:g:oldg", { n: "Old", i: null, c: null, pos: "a0V" }],
            ["pin:t:oldm", { g: "oldg", u: "https://m.example/", t: null, i: null, ti: "M", pos: "a0V" }],
            ["pin:t:oldt", { g: null, u: "https://t.example/", t: null, i: null, ti: "T", pos: "a0V" }],
          ]),
        }),
        apply: () => true,
      },
    ],
    clock,
    device: "devOld",
  });
  await syncAll([a]);
  assert.deepEqual(pinnedAreaOf(a), ["tile:t", "Old:m"]);
  assert.equal(a.with(() => Object.values(S().groups).find((g) => g.name === "Old").parentId), undefined);
});

const shippedScope = await import("../../../../../packages/sync/src/fixtures/scope-v0.2.38.ts");
const { pinnedAdapter: shippedPinnedAdapter } = await import("./fixtures/pinned-v0.2.38.ts");

class OldMac extends Device {
  async sync() {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    try {
      return await shippedScope.syncScope({ scope: "p", state: this.scopes.p, transport: this.folder.transport(), adapters: [shippedPinnedAdapter("default")], clock: this.clock, device: this.id });
    } finally {
      this.browser = S();
    }
  }
}

const pinnedGroupsOf = (d) =>
  d.with(() =>
    Object.values(S().groups)
      .filter((g) => g.pinned)
      .map((g) => `${g.name}<${g.parentId ? S().groups[g.parentId]?.name : "root"}>${g.tabIds.map(pinHost).join(",")}`)
      .sort(),
  );

test("a Mac on v0.2.38 in the sync set sees each pinned tree as one group, and leaves the nesting alone", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new OldMac("devOld", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [o1, i1, o2, c1] = ["o1", "i1", "o2", "c1"].map(open);
    S().groupTabs([o1, i1, o2], { pinned: true, name: "Outer" });
    S().groupTabs([i1], { name: "Inner" });
    S().groupTabs([c1], { pinned: true, name: "Shell" });
    S().groupTabs([c1], { name: "Core" });
  });
  const tree = ["Core<Shell>c1", "Inner<Outer>i1", "Outer<root>o1,i1,o2", "Shell<root>c1"];
  assert.deepEqual(pinnedGroupsOf(a), tree);
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  for (let i = 0; i < 4; i++) for (const d of [a, old]) await d.sync();
  assert.deepEqual(pinnedGroupsOf(old), ["Outer<root>o1,i1,o2", "Shell<root>c1"], "the old Mac shows each tree flat, the group with only a nested group included");
  assert.deepEqual(pinnedGroupsOf(a), tree, "the nesting survives the old Mac's cycles");
  const deleted = Object.entries(a.scopes.p.records).filter(([k, r]) => k.startsWith("pin") && r.v === null).map(([k]) => k);
  assert.deepEqual(deleted, [], "nothing pinned is deleted");
  const b = new Device("devB", folder);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  for (let i = 0; i < 2; i++) for (const d of [old, a, b]) await d.sync();
  assert.deepEqual(pinnedGroupsOf(b), tree, "a new Mac joining later gets the nesting");
  old.with(() => {
    const o2 = Object.values(S().tabs).find((t) => t.url === "https://o2.example/").id;
    const outer = Object.values(S().groups).find((g) => g.name === "Outer");
    S().placeTabs([o2], { pinned: false, groupId: outer.id, beforeId: outer.tabIds[0] });
  });
  for (let i = 0; i < 2; i++) for (const d of [old, a, b]) await d.sync();
  assert.deepEqual(pinnedGroupsOf(a), ["Core<Shell>c1", "Inner<Outer>i1", "Outer<root>o2,o1,i1", "Shell<root>c1"], "a reorder on the old Mac lands, nesting kept");
  assert.deepEqual(pinnedGroupsOf(b), pinnedGroupsOf(a));
});

test("two Macs nesting two groups into each other concurrently agree, and a group nested below them keeps its parent", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [x, z, y] = ["x", "z", "y"].map(open);
    S().groupTabs([x, z], { pinned: true, name: "GA" });
    S().groupTabs([z], { name: "GX" });
    S().groupTabs([y], { pinned: true, name: "GB" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinnedGroupsOf(b), ["GA<root>x,z", "GB<root>y", "GX<GA>z"]);
  const named = (n) => Object.values(S().groups).find((g) => g.name === n && g.pinned);
  a.with(() => S().moveGroup(named("GA").id, { pinned: true, parentId: named("GB").id }));
  b.with(() => S().moveGroup(named("GB").id, { pinned: true, parentId: named("GA").id }));
  await syncAll([a, b], 4);
  assert.deepEqual(pinnedGroupsOf(a), pinnedGroupsOf(b), "both Macs settle on the same tree");
  const parents = Object.fromEntries(a.with(() => Object.values(S().groups).filter((g) => g.pinned).map((g) => [g.name, g.parentId ? S().groups[g.parentId].name : null])));
  assert.equal(parents.GX, "GA", "the group below the loop keeps its parent");
  assert.equal([parents.GA, parents.GB].filter((p) => p === null).length, 1, "exactly one of the two loses its parent");
  const keyOf = (n) => a.with(() => named(n).pinKey ?? named(n).id);
  assert.equal(parents[keyOf("GA") < keyOf("GB") ? "GA" : "GB"], null, "the one with the smaller key");
  assert.equal((await a.sync()).published + (await b.sync()).published, 0, "settled");
});

test("a nested pinned group ungrouped, deleted or emptied on one Mac goes on the other", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { inner } = buildPinnedTree(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const named = (d, n) => d.with(() => Object.values(S().groups).find((g) => g.name === n));
  assert.ok(named(b, "Inner"));
  a.with(() => S().ungroup(inner));
  await syncAll([a, b]);
  assert.equal(named(b, "Inner"), undefined, "ungrouped on A, gone on B");
  assert.deepEqual(pinnedAreaOf(b), pinnedAreaOf(a));
  const again = a.with(() => {
    const outer = Object.values(S().groups).find((g) => g.name === "Outer");
    const [i1, i2] = outer.tabIds.filter((id) => ["i1", "i2"].includes(pinHost(id)));
    return S().groupTabs([i1, i2], { name: "Again" });
  });
  await syncAll([a, b]);
  assert.ok(named(b, "Again"));
  a.with(() => S().deleteGroup(again));
  await syncAll([a, b]);
  assert.equal(named(b, "Again"), undefined, "deleted on A, gone on B");
  assert.deepEqual(pinnedAreaOf(b), pinnedAreaOf(a));
  const last = a.with(() => {
    const outer = Object.values(S().groups).find((g) => g.name === "Outer");
    const o1 = outer.tabIds.find((id) => pinHost(id) === "o1");
    const g = S().groupTabs([o1], { name: "Lone" });
    return [g, o1];
  });
  await syncAll([a, b]);
  assert.ok(named(b, "Lone"));
  a.with(() => S().placeTabs([last[1]], { pinned: true, row: false, beforeId: null }));
  await syncAll([a, b]);
  assert.equal(named(a, "Lone"), undefined);
  assert.equal(named(b, "Lone"), undefined, "its last tab pinned as a tile on A, the group is gone on B");
  assert.deepEqual(pinnedAreaOf(b), pinnedAreaOf(a));
  assert.equal((await a.sync()).published + (await b.sync()).published, 0, "settled");
});

const preInterleave = await import("./fixtures/pinned-v0.2.40.ts");

class PreInterleaveMac extends Device {
  async sync() {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    try {
      return await syncScope({ scope: "p", state: this.scopes.p, transport: this.folder.transport(), adapters: [preInterleave.pinnedRowsAdapter("default"), preInterleave.pinnedAdapter("default")], clock: this.clock, device: this.id });
    } finally {
      this.browser = S();
    }
  }
}

function groupBeforeRow(d) {
  return d.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [tile, row, member] = ["tile", "row", "member"].map(open);
    S().pinTabs([tile], true);
    S().pinTabs([row], true, true);
    S().groupTabs([member], { pinned: true, name: "Group" });
    S().placeTabs([row], { pinned: true, row: true, beforeId: null, last: true });
    return w;
  });
}

for (const [label, Old, rows] of [["a build from before the interleaved order", PreInterleaveMac, true], ["v0.2.38", OldMac, false]]) {
  test(`an idle Mac on ${label} doesn't put rows back ahead of pinned groups, and its own edits still come through`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const old = new Old("devOld", folder);
    groupBeforeRow(a);
    const order = ["tile:tile", "Group:member", "row:row"];
    assert.deepEqual(pinnedAreaOf(a), order);
    old.with(() => S().createWindow({ url: "https://old-home.example/" }));
    for (let i = 0; i < 4; i++) await syncAll([a, old]);
    assert.deepEqual(pinnedAreaOf(a), order, "the idle older Mac's normalized order doesn't win");
    old.with(() => {
      const w = S().windowOrder[0];
      S().pinTabs([S().newTab(w, { url: "https://added.example/", background: true })], true, true);
    });
    for (let i = 0; i < 3; i++) await syncAll([old, a]);
    const after = pinnedAreaOf(a);
    assert.ok(after.some((x) => x.endsWith(":added")), "the older Mac's new pin arrives");
    assert.deepEqual(after.filter((x) => !x.endsWith(":added")), order, "and the interleaving stays");
    for (let i = 0; i < 2; i++) await syncAll([a, old]);
    assert.deepEqual(pinnedAreaOf(a).filter((x) => !x.endsWith(":added")), order, "still after more idle rounds");
    if (!rows) return;
    assert.deepEqual(pinnedAreaOf(a), ["tile:tile", "Group:member", "row:row", "row:added"]);
    old.with(() => {
      const at = (url) => Object.values(S().tabs).find((t) => (t.pinnedUrl || t.url) === url).id;
      S().placeTabs([at("https://added.example/")], { pinned: true, row: true, beforeId: at("https://row.example/") });
      const g = Object.values(S().groups).find((x) => x.name === "Group");
      S().updateGroup(g.id, { name: "Renamed" });
    });
    for (let i = 0; i < 3; i++) await syncAll([old, a]);
    assert.deepEqual(pinnedAreaOf(a), ["tile:tile", "Renamed:member", "row:added", "row:row"], "the older Mac's reorder and rename come through, the group keeps its place");
  });
}

function rowAndGroup(d, groupFirst) {
  return d.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [row, member] = ["row", "member"].map(open);
    S().pinTabs([row], true, true);
    const g = S().groupTabs([member], { pinned: true, name: "Group" });
    if (groupFirst) S().moveGroup(g, { pinned: true, beforeId: row });
    return { w, row, g };
  });
}
const moveGroupAbove = (d, rowUrl) =>
  d.with(() => {
    const s = S();
    const g = Object.values(s.groups).find((x) => x.name === "Group" && x.pinned);
    const row = Object.values(s.tabs).find((t) => t.pinned && t.pinnedUrl === rowUrl);
    s.moveGroup(g.id, { pinned: true, beforeId: row.id });
  });
const moveGroupToEnd = (d) =>
  d.with(() => {
    const s = S();
    const g = Object.values(s.groups).find((x) => x.name === "Group" && x.pinned);
    s.moveGroup(g.id, { pinned: true, beforeId: null });
  });
const parkedOrder = (d) =>
  d.with(() => (S().parkedPins.default?.tabs ?? []).map((t) => (t.groupId ? "Group" : new URL(t.pinnedUrl || t.url).hostname.replace(".example", ""))));

test("a Mac whose pins are parked takes a reorder into them and doesn't send its old order back", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  rowAndGroup(a, true);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinnedAreaOf(b), ["Group:member", "row:row"]);
  b.with(() => {
    const home = S().windowOrder[0];
    S().createWindow({ url: "https://b-other.example/", profileId: S().createProfile({ name: "Other" }) });
    S().closeWindow(home);
  });
  assert.deepEqual(parkedOrder(b), ["Group", "row"]);
  moveGroupToEnd(a);
  assert.deepEqual(pinnedAreaOf(a), ["row:row", "Group:member"]);
  await syncAll([a, b]);
  assert.deepEqual(parkedOrder(b), ["row", "Group"], "the parked pins take the new order");
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:row", "Group:member"], "and B's idle syncs don't put it back");
});

test("an order record that arrives before its group keeps its anchor, and the order settles on it", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  rowAndGroup(a, false);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await a.sync();
  const first = [...folder.files.keys()];
  moveGroupAbove(a, "https://row.example/");
  assert.deepEqual(pinnedAreaOf(a), ["Group:member", "row:row"]);
  await a.sync();
  first.forEach((id) => folder.hidden.add(id));
  await b.sync();
  await b.sync();
  const order = Object.entries(b.scopes.p.records).filter(([k]) => k.startsWith("pord:"));
  assert.equal(order.length, 1, "B has the order record");
  assert.deepEqual(order[0][1].v, { a: null }, "and keeps it while its group is still on its way");
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(b), ["Group:member", "row:row"]);
});

test("an order record whose anchor row is still on its way isn't replaced by a guess", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { w } = rowAndGroup(a, false);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const known = new Set(folder.files.keys());
  a.with(() => {
    const fresh = S().newTab(w, { url: "https://fresh.example/", background: true });
    S().pinTabs([fresh], true, true);
    const row = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://row.example/");
    S().placeTabs([fresh], { pinned: true, row: true, beforeId: row.id });
  });
  await a.sync();
  const rowFile = [...folder.files.keys()].filter((id) => !known.has(id));
  moveGroupAbove(a, "https://row.example/");
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row"]);
  await a.sync();
  rowFile.forEach((id) => folder.hidden.add(id));
  await b.sync();
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "Group:member", "row:row"]);
});

test("a reorder made while an order record waits for its row wins over the wait", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { w } = rowAndGroup(a, false);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const known = new Set(folder.files.keys());
  a.with(() => {
    const fresh = S().newTab(w, { url: "https://fresh.example/", background: true });
    S().pinTabs([fresh], true, true);
    const row = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://row.example/");
    S().placeTabs([fresh], { pinned: true, row: true, beforeId: row.id });
  });
  await a.sync();
  const freshFiles = [...folder.files.keys()].filter((id) => !known.has(id));
  moveGroupAbove(a, "https://row.example/");
  await a.sync();
  freshFiles.forEach((id) => folder.hidden.add(id));
  await b.sync();
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member"], "B waits with the group after its last row");
  moveGroupAbove(b, "https://row.example/");
  assert.ok((await b.sync()).published > 0, "B's own move goes out");
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(b), ["Group:member", "row:fresh", "row:row"]);
  assert.deepEqual(pinnedAreaOf(a), ["Group:member", "row:fresh", "row:row"]);
});

async function freshDelayed({ bFirst = false } = {}) {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const { w } = rowAndGroup(a, bFirst);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const known = new Set(folder.files.keys());
  a.with(() => {
    const fresh = S().newTab(w, { url: "https://fresh.example/", background: true });
    const row = Object.values(S().tabs).find((t) => t.pinnedAsRow && t.pinnedUrl === "https://row.example/");
    S().placeTabs([fresh], { pinned: true, row: true, beforeId: row.id });
  });
  await a.sync();
  const freshFiles = [...folder.files.keys()].filter((id) => !known.has(id));
  moveGroupAbove(a, "https://row.example/");
  await a.sync();
  freshFiles.forEach((id) => folder.hidden.add(id));
  await b.sync();
  await b.sync();
  return { folder, a, b };
}

const orderRecordOf = (d) => Object.entries(d.scopes.p.records).find(([k]) => k.startsWith("pord:"))?.[1];

test("a group moved away and back while its order record waits keeps the user's final place", async () => {
  const { folder, a, b } = await freshDelayed();
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member"]);
  moveGroupAbove(b, "https://row.example/");
  moveGroupToEnd(b);
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member"]);
  assert.ok((await b.sync()).published > 0, "the move goes out even though the group ended where it was");
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "row:row", "Group:member"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "row:row", "Group:member"]);
});

test("a Mac whose group already sat where a waiting record wants it leaves the record alone", async () => {
  const { folder, a, b } = await freshDelayed({ bFirst: true });
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member"], "while it waits, the group shows after the last row, as on every Mac that lacks the row");
  const before = orderRecordOf(b);
  await b.sync();
  await b.sync();
  assert.deepEqual(orderRecordOf(b), before, "no idle write");
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "Group:member", "row:row"]);
});

test("a row added below a waiting group doesn't count as moving the group", async () => {
  const { folder, a, b } = await freshDelayed();
  b.with(() => {
    const w = S().windowOrder[0];
    const x = S().newTab(w, { url: "https://x.example/", background: true });
    S().placeTabs([x], { pinned: true, row: true, beforeId: null, last: true });
  });
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member", "row:x"]);
  const before = orderRecordOf(b);
  await b.sync();
  assert.deepEqual(orderRecordOf(b)?.v, before?.v, "the group's record is unchanged");
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row", "row:x"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "Group:member", "row:row", "row:x"]);
});

for (const [label, jump] of [["a clock jump of 100 days", 100], ["a wait started with a clock a year fast", -365]]) {
  test(`a waiting order record doesn't expire on the local clock: ${label}`, async () => {
    const realNow = Date.now;
    const { folder, a, b } = await (async () => {
      if (jump < 0) Date.now = () => realNow() + 365 * 86_400_000;
      try {
        return await freshDelayed();
      } finally {
        Date.now = realNow;
      }
    })();
    if (jump > 0) Date.now = () => realNow() + jump * 86_400_000;
    try {
      await b.sync();
      await b.sync();
    } finally {
      Date.now = realNow;
    }
    assert.equal(orderRecordOf(b)?.v.a !== null, true, "the record still waits for its row");
    folder.hidden.clear();
    await syncAll([b, a], 3);
    assert.deepEqual(pinnedAreaOf(a), ["row:fresh", "Group:member", "row:row"]);
    assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "Group:member", "row:row"]);
  });
}

test("an order record whose row never arrives keeps every Mac on the same order until someone moves the group", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const w = a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    S().pinTabs([S().newTab(w, { url: "https://row.example/", background: true })], true, true);
    return w;
  });
  await a.sync();
  const rowFiles = [...folder.files.keys()];
  a.with(() => S().groupTabs([S().newTab(w, { url: "https://member.example/", background: true })], { pinned: true, name: "Group" }));
  await a.sync();
  rowFiles.forEach((id) => folder.hidden.add(id));
  b.with(() => {
    const bw = S().createWindow({ url: "https://b-home.example/" });
    S().pinTabs([S().newTab(bw, { url: "https://fresh.example/", background: true })], true, true);
  });
  await b.sync();
  await b.sync();
  assert.deepEqual(pinnedAreaOf(b), ["row:fresh", "Group:member"], "the group waits after the last row");
  assert.ok(orderRecordOf(b)?.v.a, "and its record keeps the row it follows");
  moveGroupAbove(b, "https://fresh.example/");
  await b.sync();
  assert.deepEqual(orderRecordOf(b)?.v, { a: null }, "moving the group settles it");
});

test("a tile turned into a row whose marker is still on its way is waited for as an anchor", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [x, row, member] = ["x", "row", "member"].map(open);
    S().pinTabs([x], true);
    S().pinTabs([row], true, true);
    S().groupTabs([member], { pinned: true, name: "Group" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(pinnedAreaOf(b), ["tile:x", "row:row", "Group:member"]);
  const known = new Set(folder.files.keys());
  a.with(() => {
    const at = (url) => Object.values(S().tabs).find((t) => t.pinnedUrl === url).id;
    S().placeTabs([at("https://x.example/")], { pinned: true, row: true, beforeId: at("https://row.example/") });
  });
  await a.sync();
  const promotion = [...folder.files.keys()].filter((id) => !known.has(id));
  moveGroupAbove(a, "https://row.example/");
  assert.deepEqual(pinnedAreaOf(a), ["row:x", "Group:member", "row:row"]);
  await a.sync();
  promotion.forEach((id) => folder.hidden.add(id));
  await b.sync();
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(a), ["row:x", "Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(b), ["row:x", "Group:member", "row:row"]);
});

test("Macs holding the same waiting record show the same order, whatever they showed before", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const c = new Device("devC", folder);
  const { w } = rowAndGroup(a, false);
  for (const d of [b, c]) d.with(() => S().createWindow({ url: `https://${d.id}-home.example/` }));
  await syncAll([a, b, c]);
  moveGroupAbove(b, "https://row.example/");
  await syncAll([b, a]);
  assert.deepEqual(pinnedAreaOf(b), ["Group:member", "row:row"]);
  assert.deepEqual(pinnedAreaOf(c), ["row:row", "Group:member"]);
  const known = new Set(folder.files.keys());
  a.with(() => {
    const x = S().newTab(w, { url: "https://x.example/", background: true });
    S().placeTabs([x], { pinned: true, row: true, beforeId: null, last: true });
  });
  await a.sync();
  const xFiles = [...folder.files.keys()].filter((id) => !known.has(id));
  moveGroupToEnd(a);
  assert.deepEqual(pinnedAreaOf(a), ["row:row", "row:x", "Group:member"]);
  await a.sync();
  xFiles.forEach((id) => folder.hidden.add(id));
  for (let i = 0; i < 2; i++) await syncAll([b, c]);
  assert.deepEqual(pinnedAreaOf(b), pinnedAreaOf(c));
  assert.deepEqual(pinnedAreaOf(b), ["row:row", "Group:member"]);
});

for (const [label, edit] of [
  ["a title change", (t) => S().updateTab(t.id, { customTitle: "Renamed X" })],
  ["a favicon change", (t) => S().updateTab(t.id, { customIcon: "symbol:star" })],
]) {
  test(`${label} on a row whose marker is on its way doesn't end the wait for it`, async () => {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    a.with(() => {
      const w = S().createWindow({ url: "https://home.example/" });
      const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
      const [x, row, member] = ["x", "row", "member"].map(open);
      S().pinTabs([x], true);
      S().pinTabs([row], true, true);
      S().groupTabs([member], { pinned: true, name: "Group" });
    });
    b.with(() => S().createWindow({ url: "https://b-home.example/" }));
    await syncAll([a, b]);
    const known = new Set(folder.files.keys());
    const at = (url) => Object.values(S().tabs).find((t) => t.pinnedUrl === url);
    a.with(() => S().placeTabs([at("https://x.example/").id], { pinned: true, row: true, beforeId: at("https://row.example/").id }));
    await a.sync();
    const promotion = [...folder.files.keys()].filter((id) => !known.has(id));
    moveGroupAbove(a, "https://row.example/");
    await a.sync();
    a.with(() => edit(at("https://x.example/")));
    await a.sync();
    promotion.forEach((id) => folder.hidden.add(id));
    await b.sync();
    await b.sync();
    folder.hidden.clear();
    await syncAll([b, a], 3);
    assert.deepEqual(pinnedAreaOf(a), ["row:x", "Group:member", "row:row"]);
    assert.deepEqual(pinnedAreaOf(b), ["row:x", "Group:member", "row:row"]);
  });
}

test("only evidence that the anchor left the rows after the order record ends the wait", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const row = S().newTab(w, { url: "https://row.example/", background: true });
  S().pinTabs([row], true, true);
  const group = S().groupTabs([S().newTab(w, { url: "https://member.example/", background: true })], { pinned: true, name: "Group" });
  const orderKey = `pord:g:${group}`;
  const decide = (records) => {
    const base = (k) => (k === orderKey ? { a: "x" } : undefined);
    const extraction = pinnedOrderAdapter("default").extract(base, () => false, Date.now(), (k) => k in records, (k) => records[k]?.v, (k) => records[k]?.h);
    return extraction.values.get(orderKey);
  };
  const order = { v: { a: "x" }, h: "0mvlhz4qh.0005.devA" };
  const before = "0mvlhz4qh.0001.devA";
  const after = "0mvlhz4qh.0009.devA";
  assert.deepEqual(decide({ [orderKey]: order }), { a: "x" }, "an anchor this Mac never heard of is waited for");
  assert.deepEqual(decide({ [orderKey]: order, "pin:t:x": { v: null, h: before } }), { a: "x" }, "an older tombstone doesn't end it");
  assert.deepEqual(decide({ [orderKey]: order, "pin:t:x": { v: { g: null, u: "https://x.example/", t: "New title" }, h: after } }), { a: "x" }, "a newer title change doesn't end it");
  assert.deepEqual(decide({ [orderKey]: order, "pin:t:x": { v: null, h: after } }), { a: row }, "a newer tombstone does");
  assert.deepEqual(decide({ [orderKey]: order, "pin:t:x": { v: { g: "other", u: "https://x.example/" }, h: after } }), { a: row }, "so does moving into a group afterwards");
  assert.deepEqual(decide({ [orderKey]: order, "pinrow:x": { v: 0, h: after } }), { a: row }, "and turning into a tile afterwards");
  assert.deepEqual(decide({ [orderKey]: order, "pinrow:x": { v: 1, h: after } }), { a: "x" }, "but a newer row marker means it's still a row");
});

const { compact } = await import("@ardia/sync");

async function deletedWhileAway(OldMac, withGroup) {
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const other = new OldMac("devOther", folder);
    const w = a.with(() => {
      const w = S().createWindow({ url: "https://home.example/" });
      const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
      const [r, x, m] = ["r", "x", "member"].map(open);
      S().placeTabs([r, x], { pinned: true, row: true, beforeId: null });
      if (withGroup) S().groupTabs([m], { pinned: true, name: "Group" });
      return w;
    });
    other.with(() => S().createWindow({ url: "https://other-home.example/" }));
    await syncAll([a, other], 3);
    other.with(() => {
      const x = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://x.example/").id;
      S().placeTabs([x], { pinned: false, beforeId: null });
      S().closeTab(x);
    });
    await other.sync();
    await other.sync();
    shift = 50 * 86_400_000;
    await other.sync();
    await other.with(() => compact(other.scopes.p, folder.transport(), "p", "devOther", Date.now(), {}, true));
    await a.sync();
    await a.sync();
    a.with(() => S().placeTabs([S().newTab(w, { url: "https://y.example/", background: true })], { pinned: true, row: true, beforeId: null, last: true }));
    const c = new Device("devC", folder);
    c.with(() => S().createWindow({ url: "https://c-home.example/" }));
    await syncAll([c, a, other], 3);
    return { a, c, other };
  } finally {
    Date.now = realNow;
  }
}

test("a pinned row deleted while a Mac was away past tombstone retention stays deleted when it comes back", async () => {
  const { a, c, other } = await deletedWhileAway(Device, false);
  for (const d of [a, c, other]) assert.deepEqual(pinnedAreaOf(d), ["row:r", "row:y"], d.id);
});

test.skip("known: a group anchored to a row whose tombstone was collected shows the same order on every Mac (a snapshot leaves no tombstone, so the order can't tell a deleted anchor from one still on its way; accepted)", async () => {
  const { a, c } = await deletedWhileAway(PreInterleaveMac, true);
  assert.deepEqual(pinnedAreaOf(a), pinnedAreaOf(c));
});

test("a bookmark made while another adapter is still reading survives that sync", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => S().addBookmark({ profileId: "default", url: "https://first.example/", title: "First" }));
  for (const d of [a, b]) d.with(() => S().createWindow({ url: `https://${d.id}.example/` }));
  await syncAll([a, b]);
  a.with(() => {
    const node = Object.values(S().bookmarks.nodes).find((n) => n.kind === "url" && n.url === "https://first.example/");
    S().updateBookmark(node.id, { title: "First, renamed" });
  });
  await a.sync();
  let reads = 0;
  b.passwords = adapters.passwordsAdapter(
    "default",
    () => true,
    sealedLogins(async () => {
      if (++reads === 2) S().addBookmark({ profileId: "default", url: "https://second.example/", title: "Made during the sync" });
      return stub.readLogins();
    }),
  );
  await b.sync();
  assert.equal(reads >= 2, true, "the password read ran after the bookmarks' catch-up");
  const has = (d) => d.with(() => Object.values(S().bookmarks.nodes).some((n) => n.kind === "url" && n.url === "https://second.example/"));
  assert.ok(has(b), "B keeps the bookmark made during its sync");
  await syncAll([b, a], 2);
  assert.ok(has(b), "after more syncs");
  assert.ok(has(a), "and A gets it");
  assert.ok(a.with(() => Object.values(S().bookmarks.nodes).some((n) => n.kind === "url" && n.title === "First, renamed")));
});

test("a pin unpinned and pinned again while its deletion is being pulled stays pinned", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    S().pinTabs([S().newTab(w, { url: "https://x.example/", background: true })], true, true);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b], 3);
  a.with(() => S().pinTabs([Object.values(S().tabs).find((t) => t.pinnedUrl === "https://x.example/").id], false));
  await a.sync();
  assert.ok(a.with(() => !Object.values(S().tabs).some((t) => t.pinned && t.pinnedUrl === "https://x.example/")));
  folder.onRead = () => {
    if (stub.current.device !== "devB") return;
    folder.onRead = undefined;
    const x = Object.values(S().tabs).find((t) => t.pinned && t.pinnedUrl === "https://x.example/").id;
    S().placeTabs([x], { pinned: false, beforeId: null });
    S().placeTabs([x], { pinned: true, row: true, beforeId: null });
  };
  await b.sync();
  await syncAll([b, a], 3);
  assert.deepEqual(pinnedAreaOf(b), ["row:x"], "B keeps the pin it re-pinned");
  assert.deepEqual(pinnedAreaOf(a), ["row:x"], "and A takes it back");
});

test("a snapshot dropping the anchor in the cycle a newer order record arrives doesn't settle that record", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const row = S().newTab(w, { url: "https://row.example/", background: true });
  S().pinTabs([row], true, true);
  const group = S().groupTabs([S().newTab(w, { url: "https://member.example/", background: true })], { pinned: true, name: "Group" });
  const orderKey = `pord:g:${group}`;
  const records = { [orderKey]: { v: { a: "x" }, h: "0mvlhz4qh.0009.devB" } };
  const extraction = pinnedOrderAdapter("default").extract((k) => (k === orderKey ? { a: "x" } : undefined), () => false, Date.now(), (k) => k in records, (k) => records[k]?.v, (k) => records[k]?.h);
  assert.deepEqual(extraction.values.get(orderKey), { a: "x" }, "the group keeps waiting for its row");
});

const settingsWithout = (names) => ({
  ...settingsAdapter,
  extract: (...args) => {
    const extraction = settingsAdapter.extract(...args);
    const values = new Map([...extraction.values].filter(([k]) => !names.includes(k.slice(4))));
    return { values, ignore: (key) => !values.has(key) };
  },
  apply: (visible, changed, base, records) => settingsAdapter.apply(visible, new Set([...changed].filter((k) => !names.includes(k.slice(4)))), base, records),
});

test("settings received while this Mac ran a version that didn't sync them take effect once it does, and its own choices stay", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder, { settings: settingsWithout(["selectedTabGlow", "pageScrollBars"]) });
  for (const d of [a, b]) d.with(() => S().createWindow({ url: `https://${d.id}.example/` }));
  await syncAll([a, b]);
  b.with(() => S().updateSettings({ pageScrollBars: "system" }));
  a.with(() => S().updateSettings({ selectedTabGlow: "off", pageScrollBars: "thin" }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.selectedTabGlow), "full", "the older version leaves it alone");
  assert.ok("set:selectedTabGlow" in b.scopes.app.base && !b.scopes.app.unapplied.includes("set:selectedTabGlow"), "and counts it as applied");

  b.settings = undefined;
  await syncAll([b, a]);
  assert.equal(b.with(() => S().settings.selectedTabGlow), "off", "the synced value takes effect after the upgrade");
  assert.ok(!b.with(() => S().settings.chosen?.includes("selectedTabGlow")), "as a synced value, not a choice made here");
  assert.equal(b.with(() => S().settings.pageScrollBars), "system", "a value chosen here stays");
  assert.equal(a.with(() => S().settings.pageScrollBars), "system", "and goes out as the newer edit");
  assert.equal((await b.sync()).published, 0, "settled");
});
