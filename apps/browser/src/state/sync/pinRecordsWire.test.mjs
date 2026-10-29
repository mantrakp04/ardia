import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const folders = await import("../pins/tileFolders.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const pinnedArea = await import("./pinned.ts");

const GOLDEN = new URL("./fixtures/pin-records.json", import.meta.url);
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
        return { files: shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload })), pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder) {
    this.id = id;
    this.folder = folder;
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
      return await syncScope({ scope: "p", state: this.scope, transport: this.folder.transport(), adapters: pinnedArea.pinnedAreaAdapters("default"), clock: this.clock, device: this.id });
    } finally {
      this.browser = S();
    }
  }
}

const act = (fn) => useBrowser.setState(fn(S()), true);
const host = (t) => new URL(t.pinnedUrl || t.url).hostname.replace(".example", "");

function published(folder) {
  const ids = new Map();
  const stable = (text) => text.replace(/\b[a-z]+-[a-z0-9]{4,}-[a-z0-9]+\b/g, (id) => (ids.has(id) ? ids.get(id) : (ids.set(id, `id${ids.size}`), ids.get(id))));
  return [...folder.files.values()]
    .map((f) => JSON.parse(f.payload))
    .filter((f) => f.kind === "log")
    .map((f) => ({ device: f.device, ops: f.ops.map((op) => stable(JSON.stringify([op.k, op.v]))) }));
}

test("the pinned area publishes the same records for tiles, rows, folders and pinned groups", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [mail, cal, docs, news, row, row2, g1, g2] = ["mail", "cal", "docs", "news", "row", "row2", "g1", "g2"].map(open);
    S().pinTabs([mail, cal, docs, news], true);
    S().pinTabs([row, row2], true, true);
    act((s) => folders.newTileFolder(s, [cal, docs], "Work").state);
    S().groupTabs([g1, g2], { pinned: true, name: "Group" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  for (let i = 0; i < 2; i++) for (const d of [a, b]) await d.sync();
  a.with(() => {
    const of = (h) => Object.values(S().tabs).find((t) => t.pin && host(t) === h)?.id;
    S().pinTabs([of("row")], false);
    S().placeTabs([of("news")], { pinned: true, row: true });
    act((s) => folders.renameTileFolder(s, Object.values(s.windows)[0].id, s.tabs[of("cal")].pin.folder.id, "Daily"));
  });
  b.with(() => {
    const of = (h) => Object.values(S().tabs).find((t) => t.pin && host(t) === h)?.id;
    S().pinTabs([of("row2")], true);
    S().updateTab(of("mail"), { customTitle: "Inbox" });
  });
  for (let i = 0; i < 2; i++) for (const d of [a, b]) await d.sync();
  const records = published(folder);
  if (process.env.WRITE_GOLDEN) writeFileSync(GOLDEN, `${JSON.stringify(records, null, 1)}\n`);
  assert.deepEqual(records, JSON.parse(readFileSync(GOLDEN, "utf8")));
});
