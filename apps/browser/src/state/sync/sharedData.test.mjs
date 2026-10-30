import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
const downloading = new Set();
let ids = 0;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `id${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    enterPhrase: async () => ({ ok: true }),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const files = here.filter(([id]) => !known.includes(id) && !downloading.has(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: here.map(([id]) => id).filter((id) => downloading.has(id)), damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { sharingSpaces } = await import("../spaces/spaces.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { "": true } });
    this.browser = S();
    this.docs = new Map();
  }
  async with(fn) {
    useBrowser.setState(this.browser, true);
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    try {
      return await fn();
    } finally {
      this.browser = S();
      this.docs = new Map(shell.docs);
    }
  }
}

const published = (prefix) =>
  [...folder.values()]
    .map((f) => JSON.parse(f.payload))
    .flatMap((f) => f.ops ?? Object.entries(f.records ?? {}).map(([k, r]) => ({ k, v: r.v })))
    .filter((op) => op.k.startsWith(prefix));

async function settle(macs, rounds = 4) {
  for (let i = 0; i < rounds; i++) for (const [mac, engine] of macs) await mac.with(() => engine.syncNow());
}

async function paired(tag) {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const ea = await import(`./engine.ts?spacesA${tag}`);
  const eb = await import(`./engine.ts?spacesB${tag}`);
  let ids;
  await a.with(async () => {
    const profile = S().createProfile({ name: "Work" });
    const school = S().createSpace({ name: "School", profileId: profile });
    const research = S().createSpace({ name: "Research", profileId: profile });
    ids = { profile, school, research };
    ea.startSync();
    await ea.turnOnSync("/sync");
  });
  await settle([[a, ea]]);
  await b.with(async () => { eb.startSync(); await eb.enterRecoveryPhrase("/sync", "words"); });
  await settle([[b, eb]]);
  const remote = eb.useSync.getState().remoteSpaces;
  const added = {};
  await b.with(() => { for (const item of remote) added[item.name] = eb.addRemoteSpace(item.syncId); });
  await settle([[a, ea], [b, eb]]);
  return { a, b, ea, eb, ids, added };
}

test("two added Spaces on another Mac use one canonical Profile", async () => {
  const { a, b, ea, eb, ids, added } = await paired("identity");
  assert.equal(Object.keys(added).length, 2);
  await b.with(() => {
    const one = S().spaces[added.School];
    const two = S().spaces[added.Research];
    assert.equal(one.profileId, two.profileId);
    assert.equal(S().profiles[one.profileId].name, "Work");
    assert.equal(eb.useSync.getState().profiles[one.profileId].syncId, ea.useSync.getState().profiles[ids.profile].syncId);
    assert.notEqual(one.profileId, "default");
  });
  const before = folder.size;
  await settle([[a, ea], [b, eb]], 3);
  assert.equal(folder.size, before, "the replicas stop publishing once they agree");
});

test("shared Top Apps sync with the Profile while saved rows stay in their Space", async () => {
  const { a, b, ea, eb, ids, added } = await paired("pins");
  await a.with(() => {
    const w = S().createWindow({ spaceId: ids.school });
    const app = S().newTab(w, { url: "https://app.example/", spaceId: ids.school });
    const row = S().newTab(w, { url: "https://row.example/", spaceId: ids.school });
    S().pinTabs([app], true);
    S().pinTabs([row], true, true);
  });
  await b.with(() => {
    eb.setTopAppsSynced(S().spaces[added.School].profileId, true);
    S().createWindow({ spaceId: added.School });
    S().createWindow({ spaceId: added.Research });
  });
  await settle([[a, ea], [b, eb]]);
  await b.with(() => {
    const profile = S().spaces[added.School].profileId;
    assert.equal(S().topApps[profile].filter((app) => app.url === "https://app.example/").length, 1);
    const rows = Object.values(S().tabs).filter((tab) => tab.pin?.as === "row" && tab.url === "https://row.example/");
    assert.ok(rows.length);
    assert.ok(rows.every((tab) => tab.spaceId === added.School));
  });
  const workspaceFiles = [...folder.values()].filter((file) => file.scope.startsWith("space:"));
  assert.ok(workspaceFiles.every((file) => !file.payload.includes("app.example")), "Space consent never publishes Profile-owned tiles");
});

for (const startsAsTile of [false, true]) test(`row and Top App conversions sync through their separate scopes, starting with a ${startsAsTile ? "tile" : "row"}`, async () => {
  const { a, b, ea, eb, ids, added } = await paired(`conversions-${startsAsTile}`);
  await b.with(() => {
    eb.setTopAppsSynced(S().spaces[added.School].profileId, true);
    S().createWindow({ spaceId: "default" });
    S().createWindow({ spaceId: added.School });
  });
  await a.with(() => {
    for (const [spaceId, url, row] of [["default", "https://personal-conversion.test/", !startsAsTile], [ids.school, "https://work-conversion.test/", true]]) {
      const w = S().createWindow({ spaceId });
      const tab = S().newTab(w, { spaceId, url });
      S().pinTabs([tab], true, row);
    }
  });
  await settle([[a, ea], [b, eb]]);
  await a.with(() => {
    const tab = Object.values(S().tabs).find((t) => t.url === "https://personal-conversion.test/" && t.pin);
    assert.ok(tab);
    S().placeTabs([tab.id], { pinned: true, row: false });
  });
  await b.with(() => {
    const tab = Object.values(S().tabs).find((t) => t.url === "https://work-conversion.test/" && t.pin);
    assert.ok(tab);
    S().placeTabs([tab.id], { pinned: true, row: false });
  });
  await settle([[a, ea], [b, eb]], 6);
  for (const [mac, spaceId] of [[a, ids.school], [b, added.School]]) await mac.with(() => {
    assert.deepEqual(S().topApps.default.map((app) => app.url), ["https://personal-conversion.test/"]);
    assert.deepEqual(S().topApps[S().spaces[spaceId].profileId].map((app) => app.url), ["https://work-conversion.test/"]);
    assert.equal(Object.values(S().tabs).filter((tab) => tab.pin?.as === "row" && tab.url.includes("conversion.test")).length, 0);
  });
});

test("Profile data, Top Apps, and Space consent remain independent", async () => {
  const { a, ea, ids } = await paired("consent");
  await a.with(async () => {
    ea.setProfileSynced(ids.profile, false);
    ea.setTopAppsSynced(ids.profile, false);
    ea.setSpaceSynced(ids.school, false);
    const w = S().createWindow({ spaceId: ids.research });
    const tile = S().newTab(w, { spaceId: ids.research, url: "https://local-only.example/" });
    S().pinTabs([tile], true);
    await ea.syncNow();
    assert.equal(ea.useSync.getState().spaces[ids.research].enabled, true);
    assert.equal(ea.useSync.getState().spaces[ids.school].enabled, false);
    assert.equal(ea.useSync.getState().profiles[ids.profile].enabled, false);
    assert.equal(ea.useSync.getState().profiles[ids.profile].topAppsEnabled, false);
  });
  assert.ok([...folder.values()].every((file) => !file.payload.includes("local-only.example")));
});

test("a remote Space reassignment uses the new Profile and does not reinterpret an overlapping Space ID", async () => {
  const { a, b, ea, eb, ids, added } = await paired("assignment");
  await a.with(() => S().assignSpaceProfile(ids.school, "default"));
  await settle([[a, ea], [b, eb]], 5);
  await b.with(() => {
    assert.equal(S().spaces[added.School].profileId, "default");
    assert.notEqual(S().spaces[added.Research].profileId, "default");
  });
});

test("concurrent Space rename and reorder settle on both Macs", async () => {
  const { a, b, ea, eb, ids, added } = await paired("order");
  await a.with(() => { S().updateSpace(ids.school, { name: "Study" }); S().reorderSpaces([ids.research, "default", ids.school]); });
  await b.with(() => S().updateSpace(added.Research, { name: "Reading" }));
  await settle([[a, ea], [b, eb]], 5);
  const names = (mac) => mac.with(() => S().spaceOrder.map((id) => S().spaces[id].name));
  assert.deepEqual(await names(a), await names(b));
  const before = folder.size;
  await settle([[a, ea], [b, eb]], 3);
  assert.equal(folder.size, before);
});

async function turnOn(mac, engine) {
  await mac.with(async () => { engine.startSync(); await engine.turnOnSync("/sync"); });
  await settle([[mac, engine]]);
}

async function join(mac, engine) {
  await mac.with(async () => { engine.startSync(); await engine.enterRecoveryPhrase("/sync", "words"); });
  await settle([[mac, engine]]);
}

for (const live of [false, true]) test(`a default Space on another Profile pairs while preserving ${live ? "live content" : "the seeded identity"}`, async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import(`./engine.ts?defaultOtherA${live}`);
  const engineB = await import(`./engine.ts?defaultOtherB${live}`);
  let work;
  await a.with(() => {
    work = S().createProfile({ name: "Work" });
    S().assignSpaceProfile("default", work);
    S().updateSpace("default", { name: "Study", color: "blue" });
  });
  let tab;
  if (live) await b.with(() => {
    const window = S().createWindow({ spaceId: "default" });
    tab = S().newTab(window, { url: "https://unsaved.test/", spaceId: "default" });
  });
  await turnOn(a, engineA);
  await join(b, engineB);
  await settle([[a, engineA], [b, engineB]]);
  await b.with(() => {
    const ui = engineB.useSync.getState();
    assert.equal(ui.spaces.default.syncId, engineA.useSync.getState().spaces.default.syncId);
    assert.equal(ui.profiles.default.syncId, engineA.useSync.getState().profiles.default.syncId);
    const target = Object.keys(ui.profiles).find((id) => ui.profiles[id].syncId === engineA.useSync.getState().profiles[work].syncId);
    assert.ok(target);
    assert.equal(ui.profiles[target].enabled, false);
    assert.equal(ui.profiles[target].topAppsEnabled, false);
    assert.equal(S().spaces.default.name, "Study");
    assert.equal(S().spaces.default.color, "blue");
    assert.equal(S().spaces.default.profileId, live ? "default" : target);
    assert.equal(ui.spaces.default.pendingProfileId, live ? target : undefined);
    if (live) assert.ok(S().tabs[tab]);
    assert.deepEqual(ui.remoteSpaces, []);
  });
  await a.with(() => assert.equal(S().spaces.default.profileId, work));
});

test("a paired default Space adopts a Profile identity that arrives in a later sync cycle", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?lateIdentityA");
  const engineB = await import("./engine.ts?lateIdentityB");
  let work;
  await a.with(() => {
    work = S().createProfile({ name: "Work" });
    S().assignSpaceProfile("default", work);
  });
  await turnOn(a, engineA);
  const profileSyncId = engineA.useSync.getState().profiles[work].syncId;
  const spaceSyncId = engineA.useSync.getState().spaces.default.syncId;
  const identityKey = `identity:${profileSyncId}`;
  assert.ok(published("identity:").some((op) => op.k === identityKey));
  for (const file of folder.values()) {
    if (file.scope !== "workspace-v2") continue;
    const payload = JSON.parse(file.payload);
    if (payload.ops) payload.ops = payload.ops.filter((op) => op.k !== identityKey);
    if (payload.records) delete payload.records[identityKey];
    file.payload = JSON.stringify(payload);
  }
  assert.ok(published("prof:").some((op) => op.v?.p === profileSyncId));
  await join(b, engineB);
  await b.with(() => {
    const ui = engineB.useSync.getState();
    assert.equal(ui.spaces.default.syncId, spaceSyncId);
    assert.equal(ui.spaces.default.adopting, true);
    assert.equal(S().spaces.default.profileId, "default");
    assert.equal(Object.values(ui.profiles).some((link) => link.syncId === profileSyncId), false);
  });
  await a.with(() => S().updateProfile(work, { name: "Work Arrived" }));
  await settle([[a, engineA], [b, engineB]]);
  await b.with(() => {
    const ui = engineB.useSync.getState();
    const assigned = S().spaces.default.profileId;
    assert.equal(ui.profiles[assigned].syncId, profileSyncId);
    assert.equal(S().profiles[assigned].name, "Work Arrived");
    assert.equal(ui.profiles[assigned].enabled, false);
    assert.equal(ui.profiles[assigned].topAppsEnabled, false);
    assert.equal(ui.spaces.default.adopting, undefined);
    assert.deepEqual(ui.remoteSpaces, []);
  });
  await a.with(() => assert.equal(S().spaces.default.profileId, work));
});

test("joining without a remote theme releases Space adoption and publishes a later local theme", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?themeAdoptionA");
  const engineB = await import("./engine.ts?themeAdoptionB");
  await turnOn(a, engineA);
  await join(b, engineB);
  const theme = { stops: [{ x: 0.5, y: 0.5, color: { r: 0.2, g: 0.5, b: 0.8, a: 1 } }], mode: "auto", intensity: 0.8, grain: 0.4, texture: "grain", translucency: 1 };
  await b.with(() => {
    assert.equal(engineB.useSync.getState().spaces.default.themeAdopting, undefined);
    S().updateSpace("default", { theme });
  });
  await settle([[b, engineB], [a, engineA]]);
  await a.with(() => assert.deepEqual(S().spaces.default.theme, theme));
});

const named = (name) => S().spaceOrder.find((id) => S().spaces[id].name === name);

test("a Mac that joins is offered every profile it lacks, and Add All brings them over with their look", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?offerA");
  const engineB = await import("./engine.ts?offerB");
  await a.with(() => {
    S().createSpace({ name: "Work", color: "blue", icon: "briefcase" });
    S().createSpace({ name: "Side Project", color: "orange", icon: "hammer" });
  });
  await turnOn(a, engineA);
  await join(b, engineB);
  await b.with(async () => {
    assert.equal(engineB.useSync.getState().spaces.default?.enabled, true, "Personal pairs with the synced default profile");
    assert.deepEqual(
      engineB.useSync.getState().remoteSpaces.map((p) => [p.name, p.color, p.icon]),
      [
        ["Work", "blue", "briefcase"],
        ["Side Project", "orange", "hammer"],
      ],
    );
    for (const p of engineB.useSync.getState().remoteSpaces) assert.ok(engineB.addRemoteSpace(p.syncId));
    assert.deepEqual(engineB.useSync.getState().remoteSpaces, []);
    assert.deepEqual(
      S().spaceOrder.map((id) => [S().spaces[id].name, S().spaces[id].color, S().spaces[id].icon]),
      [
        ["Personal", S().spaces.default.color, S().spaces.default.icon],
        ["Work", "blue", "briefcase"],
        ["Side Project", "orange", "hammer"],
      ],
    );
    await engineB.syncNow();
    assert.deepEqual(engineB.useSync.getState().remoteSpaces, [], "the added spaces pair with the synced ones instead of being offered again");
  });
  await a.with(async () => {
    await engineA.syncNow();
    assert.deepEqual(engineA.useSync.getState().remoteSpaces, [], "the first Mac isn't offered B's copies as new spaces");
  });
});

const syncIdOf = (engine, name) => engine.useSync.getState().spaces[named(name)]?.syncId;

test("a Mac that joins before the other Mac's spaces reach the folder waits for them, then pairs Personal", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?earlyA");
  const engineB = await import("./engine.ts?earlyB");
  await a.with(async () => {
    S().createSpace({ name: "Work" });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
  });
  assert.equal(published("prof:").length, 0, "the first Mac's first batch has its device but no spaces yet");

  await join(b, engineB);
  await b.with(() => {
    const ui = engineB.useSync.getState();
    assert.deepEqual(ui.spaces, {}, "no profile is paired from a folder with no spaces in it");
    assert.equal(ui.joining, true);
    assert.deepEqual(ui.remoteSpaces, []);
  });

  await a.with(() => engineA.syncNow());
  await b.with(() => engineB.syncNow());
  const personalOnA = await a.with(() => syncIdOf(engineA, "Personal"));
  await b.with(() => {
    const ui = engineB.useSync.getState();
    assert.equal(syncIdOf(engineB, "Personal"), personalOnA, "Personal pairs with the synced default profile");
    assert.equal(ui.joining, false);
    assert.deepEqual(ui.remoteSpaces.map((p) => p.name), ["Work"]);
  });
  await a.with(async () => {
    await engineA.syncNow();
    assert.deepEqual(engineA.useSync.getState().remoteSpaces, [], "the first Mac isn't offered a second Personal");
  });
});

test("a Mac that joins while the file with the spaces is still downloading pairs once it arrives", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?downloadA");
  const engineB = await import("./engine.ts?downloadB");
  await a.with(() => S().createSpace({ name: "Work" }));
  await turnOn(a, engineA);
  const withProfiles = [...folder].find(([, f]) => f.scope === "workspace-v2" && f.payload.includes('"prof:'))?.[0];
  assert.ok(withProfiles);
  downloading.add(withProfiles);
  try {
    await join(b, engineB);
    await b.with(() => {
      assert.deepEqual(engineB.useSync.getState().spaces, {}, "B has read A's device but not its spaces, so it doesn't pair yet");
      assert.equal(engineB.useSync.getState().pending, 1);
    });
  } finally {
    downloading.delete(withProfiles);
  }
  await b.with(() => engineB.syncNow());
  const personalOnA = await a.with(() => syncIdOf(engineA, "Personal"));
  await b.with(() => {
    assert.equal(syncIdOf(engineB, "Personal"), personalOnA);
    assert.deepEqual(engineB.useSync.getState().remoteSpaces.map((p) => p.name), ["Work"]);
  });
});

test("a Mac that joins while every file from the other devices is still downloading pairs on its own after a day", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?stuckA");
  const engineB = await import("./engine.ts?stuckB");
  await turnOn(a, engineA);
  for (const id of folder.keys()) downloading.add(id);
  try {
    await join(b, engineB);
    await b.with(async () => {
      assert.equal(engineB.useSync.getState().joining, true);
      const realNow = Date.now;
      Date.now = () => realNow() + 86_400_001;
      try {
        await engineB.syncNow();
      } finally {
        Date.now = realNow;
      }
      assert.equal(engineB.useSync.getState().joining, false);
      assert.ok(syncIdOf(engineB, "Personal"), "Personal syncs under its own id");
    });
  } finally {
    downloading.clear();
  }
});

test("a Mac that joins a folder whose other devices sync no spaces pairs on its own after a day", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?noneA");
  const engineB = await import("./engine.ts?noneB");
  await a.with(async () => {
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    engineA.setSpaceSynced("default", false);
    await engineA.syncNow();
  });
  await join(b, engineB);
  await b.with(async () => {
    assert.equal(engineB.useSync.getState().joining, true);
    const realNow = Date.now;
    Date.now = () => realNow() + 86_400_001;
    try {
      await engineB.syncNow();
    } finally {
      Date.now = realNow;
    }
    assert.equal(engineB.useSync.getState().joining, false);
    assert.ok(syncIdOf(engineB, "Personal"), "Personal syncs under its own id");
  });
});
