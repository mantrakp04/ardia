import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const writes = [], passwords = [], discarded = [];
let read, write, save, unlock, list;
const result = () => ({ failed: [], warnings: [], profile: { name: "Imported" }, tabs: [], favorites: [], spaces: [], favicons: [], history: [], credentials: [], vaultToken: "vault" });
const credentials = [1, 2].map((n) => ({ url: `https://login${n}.test/`, username: "user", password: "fixture-secret" }));
const profileData = {
  bookmarks: { type: "folder", title: "root", children: [{ type: "folder", role: "toolbar", title: "Bookmarks", children: [{ type: "url", title: "Imported bookmark", url: "https://imported-bookmark.test/" }] }] },
  history: [{ url: "https://imported-history.test/", title: "Imported history", visits: 1, lastVisit: 1 }],
};
const importedData = () => ({
  bookmarks: Object.values(S().bookmarks.nodes).some((n) => n.url === "https://imported-bookmark.test/"),
  history: Object.values(S().history).some((h) => h.list.some((entry) => entry.url === "https://imported-history.test/")),
});
globalThis.acTestNativeModules = {
  ArdiaImport: {
    addListener: () => ({ remove() {} }),
    importData: async () => JSON.stringify(await read()),
    importSafariExport: async () => JSON.stringify(await read()),
    importSafariDirect: async () => JSON.stringify(await read()),
    unlockBrowser: async () => unlock(),
    writeImported: async (token, profile) => { writes.push({ token, profile }); await write(); return JSON.stringify({ cookies: 1 }); },
    discardImported: (token) => discarded.push(token),
    listExtensions: async () => JSON.stringify(await list()), forgetUnlockedKeys() {},
  },
  ArdiaPasswords: { save: async (profile) => { passwords.push(profile); await save(); return JSON.stringify({ ok: true }); } },
};
const api = await import("@ardia/import");
globalThis.require = () => api;
const { useBrowser } = await import("../browser/store.ts");
const { importNow, patchImport, setImportTarget, backTo, openFoundExtensions } = await import("./flow.ts");
const { runImport, unlockAndImport } = await import("./runImport.ts");
const { importSafariDirect, importSafariExport } = await import("./fileImports.ts");
const S = () => useBrowser.getState();
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function setup() {
  S().hydrate({});
  useBrowser.setState({ bookmarks: { nodes: {} }, bookmarksReady: {}, history: {} });
  writes.length = passwords.length = discarded.length = 0;
  read = async () => result(); write = save = unlock = async () => {};
  list = async () => [];
  const owner = S().createProfile({ name: "Import destination" });
  const other = S().createProfile({ name: "Other identity" });
  const target = S().createSpace({ name: "Import here", profileId: owner });
  const source = { id: "chrome", family: "chromium", name: "Chrome", profiles: [{ id: "source", name: "Source", isDefault: true, available: ["cookies", "passwords", "bookmarks", "history"] }] };
  patchImport({ source, sourceProfiles: ["source"], spaces: [], target });
  return { owner, other, target };
}

async function assertStopped() {
  await delay(1);
  assert.equal(importNow().step.name, "done");
  assert.match(importNow().step.notes.join(" "), /destination Space or Profile changed/);
}

for (const useDefault of [false, true]) test(`an unchanged destination imports cookies and passwords: default=${useDefault}`, async () => {
  const { owner } = setup();
  if (useDefault) patchImport({ target: "default" });
  const engine = useDefault ? "" : owner;
  read = async () => ({ ...result(), ...profileData, credentials });
  await runImport(new Set(["cookies", "passwords", "bookmarks", "history"]));
  await delay(1);
  assert.deepEqual(writes, [{ token: "vault", profile: engine }]);
  assert.deepEqual(passwords, [engine, engine]);
  assert.equal(importNow().step.counts.passwords, 2);
  assert.equal(importNow().step.counts.bookmarks, 1);
  assert.equal(importNow().step.counts.history, 1);
  assert.deepEqual(importNow().step.notes, []);
});

for (const change of ["reassign", "delete-profile", "delete-space"]) test(`import stops if its destination changes during reading: ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => { started.resolve(); await gate.promise; return { ...result(), credentials }; };
  const pending = runImport(new Set(["cookies", "passwords"]));
  await started.promise;
  if (change === "reassign") S().assignSpaceProfile(target, other);
  if (change === "delete-profile") S().deleteProfile(owner, other);
  if (change === "delete-space") S().deleteSpace(target);
  gate.resolve(); await pending;
  assert.deepEqual(writes, []); assert.deepEqual(passwords, []);
  assert.deepEqual(discarded, ["vault"]);
  await assertStopped();
});

for (const [name, entry] of [["browser", () => runImport(new Set(["cookies", "passwords", "bookmarks", "history"]))], ["Safari", importSafariDirect], ["Safari export", () => importSafariExport("fixture.zip")]])
for (const change of ["reassign", "delete-profile", "select-space"]) test(`an in-flight ${name} native import cannot redirect later passwords after ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => ({ ...result(), ...profileData, credentials, profiles: [{ history: profileData.history }] });
  write = async () => { started.resolve(); await gate.promise; };
  const pending = entry();
  await started.promise;
  const before = importedData();
  if (change === "reassign") S().assignSpaceProfile(target, other);
  else if (change === "delete-profile") S().deleteProfile(owner, other);
  else setImportTarget(S().createSpace({ name: "New destination", profileId: other }));
  gate.resolve(); await pending;
  assert.deepEqual(before, { bookmarks: false, history: false });
  assert.deepEqual(importedData(), { bookmarks: false, history: false });
  assert.deepEqual(writes, [{ token: "vault", profile: owner }]);
  assert.deepEqual(passwords, []);
  await assertStopped();
});

for (const change of ["reassign", "delete-profile"]) test(`extension listing cannot offer actions after ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  list = async () => { started.resolve(); await gate.promise; return [{ id: "fixture-extension", name: "Fixture" }]; };
  const pending = runImport(new Set(["cookies"]));
  await started.promise;
  if (change === "reassign") S().assignSpaceProfile(target, other);
  else S().deleteProfile(owner, other);
  gate.resolve(); await pending;
  await assertStopped();
  assert.deepEqual(importNow().step.extensions, { groups: [], opened: false });
});

test("later source imports cannot retain an extension action for a changed earlier destination", async () => {
  const { other, target } = setup();
  const profiles = ["one", "two"].map((id) => ({ id, name: id, isDefault: id === "one", available: ["cookies"] }));
  patchImport({ source: { id: "chrome", family: "chromium", name: "Chrome", profiles }, sourceProfiles: profiles.map((p) => p.id) });
  const started = deferred(), gate = deferred();
  let calls = 0;
  list = async () => { if (++calls === 2) { started.resolve(); await gate.promise; } return [{ id: "fixture-extension", name: "Fixture" }]; };
  const pending = runImport(new Set(["cookies"]));
  await started.promise; S().assignSpaceProfile(target, other); gate.resolve(); await pending;
  await assertStopped();
  assert.deepEqual(importNow().step.extensions, { groups: [], opened: false });
});

for (const change of ["reassign", "delete-profile"]) test(`password writes stop between credentials after ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => ({ ...result(), vaultToken: undefined, credentials });
  save = async () => { started.resolve(); await gate.promise; };
  const pending = runImport(new Set(["passwords"]));
  await started.promise;
  if (change === "reassign") S().assignSpaceProfile(target, other);
  else S().deleteProfile(owner, other);
  gate.resolve(); await pending;
  assert.deepEqual(passwords, [owner]);
  await assertStopped();
});

for (const entry of [importSafariDirect, () => importSafariExport("fixture.zip")]) test(`Safari entry ${entry.name || "export"} captures the destination before reading`, async () => {
  const { other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => { started.resolve(); await gate.promise; return { ...result(), profiles: [], credentials }; };
  const pending = entry();
  await started.promise; S().assignSpaceProfile(target, other); gate.resolve(); await pending;
  assert.deepEqual(writes, []); assert.deepEqual(passwords, []);
  assert.deepEqual(discarded, ["vault"]);
  await assertStopped();
});

for (const change of ["reassign", "delete-profile", "delete-space"]) test(`unlock keeps the original destination through ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  let reads = 0;
  unlock = async () => { started.resolve(); await gate.promise; };
  read = async () => { reads++; return { ...result(), credentials }; };
  patchImport({ kinds: new Set(["cookies", "passwords"]), step: { name: "unlock", unlocking: false, error: null } });
  const pending = unlockAndImport();
  await started.promise;
  if (change === "reassign") S().assignSpaceProfile(target, other);
  if (change === "delete-profile") S().deleteProfile(owner, other);
  if (change === "delete-space") S().deleteSpace(target);
  gate.resolve(); await pending; await delay(1);
  assert.deepEqual(writes, []); assert.deepEqual(passwords, []);
  assert.equal(reads, 0);
  await assertStopped();
});

for (const useDefault of [false, true]) test(`unlock still imports into an unchanged destination: default=${useDefault}`, async () => {
  const { owner } = setup();
  patchImport({ ...(useDefault ? { target: "default" } : {}), kinds: new Set(["cookies", "passwords"]), step: { name: "unlock", unlocking: false, error: null } });
  read = async () => ({ ...result(), credentials });
  await unlockAndImport(); await delay(1);
  const engine = useDefault ? "" : owner;
  assert.deepEqual(writes, [{ token: "vault", profile: engine }]);
  assert.deepEqual(passwords, [engine, engine]);
  assert.deepEqual(importNow().step.notes, []);
});

test("selecting another Space while unlocking stops the old import before reading data", async () => {
  const { other } = setup();
  const next = S().createSpace({ name: "New destination", profileId: other });
  const started = deferred(), gate = deferred();
  let reads = 0;
  unlock = async () => { started.resolve(); await gate.promise; };
  read = async () => { reads++; return { ...result(), credentials }; };
  patchImport({ kinds: new Set(["cookies", "passwords"]), step: { name: "unlock", unlocking: false, error: null } });
  const pending = unlockAndImport();
  await started.promise; backTo("profiles"); setImportTarget(next); gate.resolve(); await pending;
  assert.deepEqual(writes, []); assert.deepEqual(passwords, []); assert.equal(reads, 0);
  await assertStopped();
});

for (const change of ["reassign", "select-space", "delete-profile"]) test(`a failed source read retains the destination warning after ${change}`, async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => { started.resolve(); await gate.promise; throw new Error("Unreadable source"); };
  const pending = runImport(new Set(["cookies"]));
  await started.promise;
  if (change === "reassign") S().assignSpaceProfile(target, other);
  else if (change === "delete-profile") S().deleteProfile(owner, other);
  else setImportTarget(S().createSpace({ name: "New destination", profileId: other }));
  gate.resolve(); await pending;
  assert.deepEqual(writes, []); assert.deepEqual(passwords, []);
  await assertStopped();
  assert.deepEqual(importNow().step.extensions, { groups: [], opened: false });
});

for (const phase of ["native", "password", "listing"]) test(`a new target selection stops the captured operation during ${phase}`, async () => {
  const { owner, other } = setup();
  const next = S().createSpace({ name: "New destination", profileId: other });
  const started = deferred(), gate = deferred();
  read = async () => ({ ...result(), credentials });
  const wait = async () => { started.resolve(); await gate.promise; };
  if (phase === "native") write = wait;
  if (phase === "password") save = wait;
  if (phase === "listing") list = async () => { await wait(); return [{ id: "fixture-extension", name: "Fixture" }]; };
  const pending = runImport(new Set(["cookies", "passwords"]));
  await started.promise; setImportTarget(next); gate.resolve(); await pending;
  assert.deepEqual(writes, [{ token: "vault", profile: owner }]);
  assert.deepEqual(passwords, Array(phase === "native" ? 0 : phase === "password" ? 1 : 2).fill(owner));
  await assertStopped();
  assert.deepEqual(importNow().step.extensions, { groups: [], opened: false });
});

for (const count of [1, 2]) test(`extension pages open in each of ${count} imported destination Profiles`, async () => {
  const { owner } = setup();
  const profiles = Array.from({ length: count }, (_, i) => ({ id: `source-${i}`, name: `Source ${i}`, available: ["cookies"] }));
  patchImport({ source: { id: "chrome", family: "chromium", name: "Chrome", profiles }, sourceProfiles: profiles.map((p) => p.id) });
  let index = 0;
  list = async () => {
    const i = index++;
    return [{ id: "shared", name: "Shared", webStoreUrl: "https://chromewebstore.google.com/detail/shared" }, { id: `unique-${i}`, name: `Unique ${i}`, webStoreUrl: `https://chromewebstore.google.com/detail/unique-${i}` }];
  };
  await runImport(new Set(["cookies"])); await delay(1);
  openFoundExtensions();
  const shared = Object.values(S().tabs).filter((t) => t.url === "https://chromewebstore.google.com/detail/shared");
  assert.equal(shared.length, count);
  assert.equal(new Set(shared.map((t) => S().spaces[t.spaceId].profileId)).size, count);
  for (let i = 0; i < count; i++) {
    const tab = Object.values(S().tabs).find((t) => t.url === `https://chromewebstore.google.com/detail/unique-${i}`);
    assert.ok(tab);
    assert.equal(S().profiles[S().spaces[tab.spaceId].profileId].engineId, writes[i].profile);
  }
  assert.ok(shared.some((t) => S().spaces[t.spaceId].profileId === owner));
});

test("extension actions stop if an imported destination changes after completion", async () => {
  const { other, target } = setup();
  list = async () => [{ id: "fixture", name: "Fixture", webStoreUrl: "https://chromewebstore.google.com/detail/fixture" }];
  await runImport(new Set(["cookies"])); await delay(1);
  S().assignSpaceProfile(target, other);
  openFoundExtensions();
  assert.equal(Object.values(S().tabs).some((t) => t.url === "https://chromewebstore.google.com/detail/fixture"), false);
  await assertStopped();
});
