import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const writes = [], passwords = [], discarded = [];
let read, write, save;
const result = () => ({ failed: [], warnings: [], profile: { name: "Imported" }, tabs: [], favorites: [], spaces: [], favicons: [], history: [], credentials: [], vaultToken: "vault" });
const credentials = [1, 2].map((n) => ({ url: `https://login${n}.test/`, username: "user", password: "fixture-secret" }));
globalThis.acTestNativeModules = {
  ArdiaImport: {
    addListener: () => ({ remove() {} }),
    importData: async () => JSON.stringify(await read()),
    importSafariExport: async () => JSON.stringify(await read()),
    importSafariDirect: async () => JSON.stringify(await read()),
    writeImported: async (token, profile) => { writes.push({ token, profile }); await write(); return JSON.stringify({ cookies: 1 }); },
    discardImported: (token) => discarded.push(token),
    listExtensions: async () => "[]", forgetUnlockedKeys() {},
  },
  ArdiaPasswords: { save: async (profile) => { passwords.push(profile); await save(); return JSON.stringify({ ok: true }); } },
};
const api = await import("@ardia/import");
globalThis.require = () => api;
const { useBrowser } = await import("../browser/store.ts");
const { importNow, patchImport } = await import("./flow.ts");
const { runImport } = await import("./runImport.ts");
const { importSafariDirect, importSafariExport } = await import("./fileImports.ts");
const S = () => useBrowser.getState();
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function setup() {
  S().hydrate({});
  writes.length = passwords.length = discarded.length = 0;
  read = async () => result(); write = save = async () => {};
  const owner = S().createProfile({ name: "Import destination" });
  const other = S().createProfile({ name: "Other identity" });
  const target = S().createSpace({ name: "Import here", profileId: owner });
  const source = { id: "chrome", family: "chromium", name: "Chrome", profiles: [{ id: "source", name: "Source", isDefault: true, available: ["cookies", "passwords"] }] };
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
  read = async () => ({ ...result(), credentials });
  await runImport(new Set(["cookies", "passwords"]));
  await delay(1);
  assert.deepEqual(writes, [{ token: "vault", profile: engine }]);
  assert.deepEqual(passwords, [engine, engine]);
  assert.equal(importNow().step.counts.passwords, 2);
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

test("an in-flight native import cannot redirect later passwords into another Profile", async () => {
  const { owner, other, target } = setup();
  const started = deferred(), gate = deferred();
  read = async () => ({ ...result(), credentials });
  write = async () => { started.resolve(); await gate.promise; };
  const pending = runImport(new Set(["cookies", "passwords"]));
  await started.promise; S().assignSpaceProfile(target, other); gate.resolve(); await pending;
  assert.deepEqual(writes, [{ token: "vault", profile: owner }]);
  assert.deepEqual(passwords, []);
  await assertStopped();
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
