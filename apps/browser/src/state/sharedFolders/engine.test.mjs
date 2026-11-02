import assert from "node:assert/strict";
import { test } from "node:test";
import { shellNativeModules } from "../../test-native/shell.ts";

const shares = [];

const webloc = (url) => `<plist><dict><key>URL</key><string>${url}</string></dict></plist>`;
const events = [];
const files = new Map();
const landed = new Map();
const pending = new Map();
const failing = new Set();
const unstageable = new Set();
let duringRead = async () => {};
const byPath = new Map();
let listing = { exists: true, root: { entries: [], manifest: null, manifestPending: false } };

function land(name) {
  const contents = pending.get(name);
  if (contents === undefined) return null;
  if (failing.has(name)) return new Error(`saving ${name} failed`);
  pending.delete(name);
  landed.set(name, contents);
  events.push(`landed ${name}`);
  return null;
}

globalThis.acTestNativeModules = {
  ArdiaApp: { ...shellNativeModules.ArdiaApp, share: async (url) => void (shares.push(url), events.push("share")) },
  ArdiaDocuments: {
    readDocument: (name) => pending.get(name) ?? landed.get(name) ?? null,
    writeDocument: (name, contents) => {
      if (unstageable.has(name)) throw new Error(`can't stage ${name}`);
      pending.set(name, contents);
      setTimeout(() => land(name), 5);
    },
    saveDocument: async (name, contents) => void pending.set(name, contents),
    documentSaved: (name) =>
      new Promise((resolve, reject) =>
        setTimeout(() => {
          events.push(`awaited ${name}`);
          const error = land(name);
          error ? reject(error) : resolve();
        }, 20),
      ),
    removeDocument: (name) => void (pending.delete(name), landed.delete(name)),
  },
  ArdiaSharedFolders: {
    location: () => ({ path: "/scratch/Ardia Shared", iCloudAvailable: true, iCloudPath: "/scratch" }),
    read: async (path) => {
      events.push(`read ${path}`);
      const now = byPath.get(path) ?? listing;
      await duringRead();
      return now;
    },
    apply: async (path, ops) => (events.push(`apply ${path} ${JSON.parse(ops).length}`), files.set("ops", JSON.parse(ops)), { conflicts: [] }),
    create: async (parent, name) => `${parent}/${name}`,
    watch: () => {},
    addListener: () => ({ remove() {} }),
  },
};

const { startPersistence } = await import("../session/persist.ts");
const { useBrowser } = await import("../browser/store.ts");
const { pinKeyOf } = await import("../browser/model.ts");
const { syncFolderNow } = await import("./engine.ts");
const { bindFolder, sharedFolderOf, unbindFolder, useSharedFolders } = await import("./store.ts");
const { shareFolder } = await import("./actions.ts");

const S = () => useBrowser.getState();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let persisting = false;
function fresh() {
  if (!persisting) (startPersistence(), (persisting = true));
  events.length = 0;
  failing.clear();
  unstageable.clear();
  listing = { exists: true, root: { entries: [], manifest: null, manifestPending: false } };
  duringRead = async () => {};
  byPath.clear();
}

function setup() {
  fresh();
  const w = S().createWindow({ url: "https://home.example/" });
  const t = S().newTab(w, { url: "https://one.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Team" });
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  bindFolder(profileId, key, "/scratch/Ardia Shared/Team");
  return { profileId, key };
}

test("a session that can't be saved stops the round before any file changes or base advance", async () => {
  const { profileId, key } = setup();
  await wait(900);
  listing = { exists: true, root: { entries: [{ kind: "link", file: "From Mac B.webloc", text: webloc("https://b.example/") }], manifest: null, manifestPending: false } };
  failing.add("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  assert.ok(S().groups && Object.values(S().tabs).some((t) => t.pinnedUrl === "https://b.example/"), "the sidebar shows the link");
  assert.deepEqual(events.filter((e) => e.startsWith("apply")), [], "no file is touched");
  assert.equal(sharedFolderOf(profileId, key).base.length, 0, "the base doesn't move");
  assert.notEqual(useSharedFolders.getState().sync[`${profileId}\u0001${key}`]?.state, "synced");
  await wait(600);
  assert.ok(!(landed.get("shared-folders.json") ?? "").includes("b.example"), "no saved base names the link");

  failing.delete("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  const imported = sharedFolderOf(profileId, key).base.find((b) => b.url === "https://b.example/")?.key;
  assert.ok(imported, "once the session lands, the base takes the link");
  assert.ok(landed.get("session.json").includes(imported), "the landed session holds the tab");
  const sessionLanded = events.findIndex((e) => e === "landed session.json");
  const firstApply = events.findIndex((e) => e.startsWith("apply"));
  assert.ok(sessionLanded >= 0 && firstApply > sessionLanded, `the session landed (#${sessionLanded}) before any file change (#${firstApply})`);
});

test("a session snapshot that never got staged stops the round too, and is staged again next time", async () => {
  fresh();
  const w = S().createWindow({ url: "https://home2.example/" });
  const t = S().newTab(w, { url: "https://two.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Second" });
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  bindFolder(profileId, key, "/scratch/Ardia Shared/Second");
  await wait(900);
  listing = { exists: true, root: { entries: [{ kind: "link", file: "Staged.webloc", text: webloc("https://staged.example/") }], manifest: null, manifestPending: false } };
  unstageable.add("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  assert.deepEqual(events.filter((e) => e.startsWith("apply")), [], "no file is touched while the session can't be staged");
  assert.equal(sharedFolderOf(profileId, key).base.length, 0, "the base doesn't move");
  unstageable.delete("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  const imported = sharedFolderOf(profileId, key).base.find((b) => b.url === "https://staged.example/")?.key;
  assert.ok(imported, "the next round goes through");
  assert.ok(landed.get("session.json").includes(imported), "the session that landed holds the tab");
});

test("a folder unbound and bound again while its round reads changes neither binding", async () => {
  const { profileId, key } = setup();
  await wait(900);
  const oldPath = "/scratch/Ardia Shared/Team";
  byPath.set(oldPath, { exists: true, root: { entries: [{ kind: "link", file: "Old.webloc", text: webloc("https://old-folder.example/") }], manifest: null, manifestPending: false } });
  duringRead = async () => {
    duringRead = async () => {};
    unbindFolder(profileId, key);
    bindFolder(profileId, key, "/scratch/Ardia Shared/Elsewhere");
  };
  await syncFolderNow(profileId, key);
  await wait(400);
  await syncFolderNow(profileId, key);
  assert.deepEqual(events.filter((e) => e.startsWith(`apply ${oldPath} `)), [], "nothing is written for the old binding");
  assert.equal(sharedFolderOf(profileId, key).path, "/scratch/Ardia Shared/Elsewhere");
  assert.ok(!sharedFolderOf(profileId, key).base.some((b) => b.url === "https://old-folder.example/"), "the new binding never takes the old folder's links");
  assert.ok(!Object.values(S().tabs).some((t) => t.pinnedUrl === "https://old-folder.example/"), "the old folder's links aren't imported");
});

test("a read that fails after the folder was bound again doesn't mark the new binding as failing", async () => {
  const { profileId, key } = setup();
  await wait(900);
  duringRead = async () => {
    duringRead = async () => {};
    unbindFolder(profileId, key);
    bindFolder(profileId, key, "/scratch/Ardia Shared/Fresh");
    throw new Error("the old disk went away");
  };
  await syncFolderNow(profileId, key);
  assert.notEqual(useSharedFolders.getState().sync[`${profileId}\u0001${key}`]?.state, "error");
});

test("Share Folder doesn't open the share sheet when the folder's first sync failed", async () => {
  fresh();
  const w = S().createWindow({ url: "https://home3.example/" });
  const t = S().newTab(w, { url: "https://three.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Third" });
  await wait(900);
  shares.length = 0;
  const read = globalThis.acTestNativeModules.ArdiaSharedFolders.read;
  globalThis.acTestNativeModules.ArdiaSharedFolders.read = async () => {
    throw new Error("disk went away");
  };
  await shareFolder(w, g);
  globalThis.acTestNativeModules.ArdiaSharedFolders.read = read;
  assert.deepEqual(shares, [], "no share sheet for a folder whose links weren't written");
  await shareFolder(w, g);
  assert.equal(shares.length, 1, "once the folder syncs, Share Folder opens the sheet");
});

test("unbinding and binding the same path again during a read still counts as a new binding", async () => {
  const { profileId, key } = setup();
  await wait(900);
  const path = "/scratch/Ardia Shared/Team";
  listing = { exists: true, root: { entries: [{ kind: "link", file: "Before.webloc", text: webloc("https://before-rebind.example/") }], manifest: null, manifestPending: false } };
  let replaced;
  duringRead = async () => {
    duringRead = async () => {};
    unbindFolder(profileId, key);
    bindFolder(profileId, key, path);
    replaced = sharedFolderOf(profileId, key);
  };
  await syncFolderNow(profileId, key);
  assert.equal(sharedFolderOf(profileId, key), replaced, "the round never saved a base over the new binding");
  assert.deepEqual(replaced.base, []);
  assert.deepEqual(events.filter((e) => e.startsWith("apply")), [], "nothing was written for the old binding's round");
  assert.ok(!Object.values(S().tabs).some((t) => t.pinnedUrl === "https://before-rebind.example/"), "the stale read wasn't applied");
});

test("Share Folder waits for a round that starts after it, not one already running", async () => {
  fresh();
  const w = S().createWindow({ url: "https://home4.example/" });
  const t = S().newTab(w, { url: "https://four.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Fourth" });
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  bindFolder(profileId, key, "/scratch/Ardia Shared/Fourth");
  await wait(900);
  await syncFolderNow(profileId, key);
  let release;
  const gate = new Promise((r) => (release = r));
  duringRead = async () => {
    duringRead = async () => {};
    await gate;
  };
  events.length = 0;
  const running = syncFolderNow(profileId, key);
  await wait(20);
  const sharing = shareFolder(w, g);
  await wait(20);
  release();
  await Promise.all([running, sharing]);
  const reads = events.filter((e) => e.startsWith("read "));
  const shared = events.indexOf("share");
  assert.ok(shared >= 0, "the sheet opened");
  assert.equal(events.slice(0, shared).filter((e) => e.startsWith("read ")).length, 2, `a fresh round ran before the sheet (${reads.length} reads)`);
});
