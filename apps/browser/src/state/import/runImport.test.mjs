import assert from "node:assert/strict";
import { test } from "node:test";

const writes = [];
globalThis.acTestNativeModules = { ArdiaImport: {
  addListener: () => ({ remove() {} }),
  importData: async (_job, _browser, profile) => {
    if (profile === "broken") throw new Error("Unreadable source");
    return JSON.stringify({ failed: [], warnings: [], profile: { name: "Work" }, tabs: [], favorites: [], spaces: [], favicons: [], history: [], credentials: [], vaultToken: "work-vault" });
  },
  writeImported: async (token, profile) => { writes.push({ token, profile }); return JSON.stringify({ cookies: 1 }); },
  listExtensions: async () => "[]",
  forgetUnlockedKeys() {},
} };
const api = await import("@ardia/import");
globalThis.require = (name) => { assert.equal(name, "@ardia/import"); return api; };
const { useBrowser } = await import("../browser/store.ts");
const { patchImport } = await import("./flow.ts");
const { runImport } = await import("./runImport.ts");
const S = () => useBrowser.getState();

test("a failed first import does not create a disconnected destination Profile", async () => {
  S().hydrate({});
  const profiles = ["broken", "work"].map((id) => ({ id, name: id, isDefault: false, available: ["cookies"] }));
  patchImport({ source: { id: "chrome", family: "chromium", name: "Chrome", profiles }, sourceProfiles: profiles.map((p) => p.id), spaces: [], target: "default" });
  await runImport(new Set(["cookies"]));
  assert.equal(Object.keys(S().profiles).length, 1);
  assert.deepEqual(writes, [{ token: "work-vault", profile: S().profiles[S().spaces.default.profileId].engineId }]);
});
