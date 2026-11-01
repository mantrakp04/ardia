import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { Clock, compact, emptyScope, syncScope } from "@ardia/sync";
import { topAppsAdapter } from "./identityAdapters.ts";

const S = () => useBrowser.getState();
const item = (key) => ({ key, url: `https://${key}.test`, title: key, favicon: null, customTitle: null, customIcon: null });
let wall = 1900000000000;

class Folder {
  files = new Map();
  sequence = 0;
  hidden = new Set();
  transport = {
    write: async (scope, payload) => { const id = `f${++this.sequence}`; this.files.set(id, { scope, payload }); return id; },
    read: async (scope, known) => {
      const here = [...this.files].filter(([id, file]) => file.scope === scope && !this.hidden.has(id));
      return { files: here.filter(([id]) => !known.includes(id)).map(([id, file]) => ({ id, payload: file.payload })), present: here.map(([id]) => id), pending: [], damaged: [] };
    },
    remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
  };
}

class Mac {
  constructor(id, folder, items = []) {
    this.id = id;
    this.folder = folder;
    this.scope = emptyScope();
    this.clock = new Clock(id, null, () => ++wall);
    S().hydrate({ topApps: { default: items } });
    this.browser = S();
  }
  with(fn) {
    useBrowser.setState({ ...this.browser, topApps: { ...this.browser.topApps } }, true);
    try { return fn(); } finally { this.browser = S(); }
  }
  edit(fn) { this.with(() => useBrowser.setState({ topApps: { default: fn(S().topApps.default) } })); }
  async sync() {
    useBrowser.setState({ ...this.browser, topApps: { ...this.browser.topApps } }, true);
    try { return await syncScope({ scope: "data:profile", state: this.scope, transport: this.folder.transport, adapters: [topAppsAdapter("default")], clock: this.clock, device: this.id, now: () => ++wall }); }
    finally { this.browser = S(); }
  }
  get items() { return this.browser.topApps.default; }
}

const edits = [
  (items) => items,
  (items) => items.map((app) => app.key === "a" ? { ...app, customTitle: "Renamed" } : app),
  (items) => items.filter((app) => app.key !== "a"),
  (items) => [...items, item("d")],
  (items) => [...items].reverse(),
  (items) => items.map((app) => ["a", "b"].includes(app.key) ? { ...app, tileFolder: { id: "folder", name: "Projects" } } : app),
];

test("concurrent Profile Top App additions, removals, names, folders and order converge across delayed pulls", async () => {
  for (const first of edits) for (const second of edits) for (const delayed of [false, true]) {
    const folder = new Folder();
    const a = new Mac("A", folder, [item("a"), item("b"), item("c")]);
    await a.sync();
    const b = new Mac("B", folder);
    await b.sync();
    a.edit(first);
    b.edit(second);
    await a.sync();
    if (delayed) folder.hidden = new Set(folder.files.keys());
    await b.sync();
    folder.hidden.clear();
    for (let i = 0; i < 4; i++) { await a.sync(); await b.sync(); }
    assert.deepEqual(a.items, b.items);
    const count = folder.sequence;
    await a.sync(); await b.sync();
    assert.equal(folder.sequence, count, "settled Profiles stop publishing");
    assert.equal(new Set(a.items.map((app) => app.key)).size, a.items.length);
  }
});

test("Top App deletions survive a snapshot, an offline Mac and a new joining Mac", async () => {
  const folder = new Folder();
  const a = new Mac("A", folder, [item("a"), item("b")]);
  await a.sync();
  const b = new Mac("B", folder);
  await b.sync();
  a.edit((items) => items.filter((app) => app.key !== "a"));
  await a.sync();
  await compact(a.scope, folder.transport, "data:profile", a.id, wall, {}, true);
  await b.sync();
  const c = new Mac("C", folder);
  await c.sync();
  assert.deepEqual(a.items.map((app) => app.key), ["b"]);
  assert.deepEqual(b.items, a.items);
  assert.deepEqual(c.items, a.items);
});
