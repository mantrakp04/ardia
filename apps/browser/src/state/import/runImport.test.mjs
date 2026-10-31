import assert from "node:assert/strict";
import { test } from "node:test";

const writes = [];
globalThis.acTestNativeModules = { ArdiaImport: {
  addListener: () => ({ remove() {} }),
  importData: async (_job, _browser, profile) => {
    if (profile === "broken") throw new Error("Unreadable source");
    if (profile.startsWith("arc-")) return JSON.stringify({
      failed: [], warnings: [], profile: { name: profile }, tabs: [], favorites: [], favicons: [], history: [], credentials: [], vaultToken: `${profile}-vault`,
      spaces: [1, 2].map((n) => ({ id: `${profile}-${n}`, name: `${profile} ${n}`, profileId: profile, pinned: [], tabs: [{ url: `https://${profile}.test/${n}`, title: `${profile} ${n}`, pinned: false }] })),
    });
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

for (const sourceCount of [1, 2]) test(`Arc import keeps two Spaces together for each of ${sourceCount} source Profiles`, async () => {
  S().hydrate({});
  writes.length = 0;
  const targetProfile = S().createProfile({ name: "Destination" });
  const target = S().createSpace({ name: "Selected target", profileId: targetProfile });
  const beforeProfiles = Object.keys(S().profiles).length;
  const profiles = Array.from({ length: sourceCount }, (_, i) => ({
    id: `arc-${i}`, name: `Arc Profile ${i}`, isDefault: i === 0, available: ["cookies", "tabs"],
    spaces: [1, 2].map((n) => ({ id: `arc-${i}-${n}`, name: `Space ${n}`, pinnedCount: 0, tabCount: 1 })),
  }));
  patchImport({ source: { id: "arc", family: "arc", sidebar: "arc", name: "Arc", profiles }, sourceProfiles: profiles.map((p) => p.id), spaces: profiles.flatMap((p) => p.spaces.map((s) => s.id)), target });
  await runImport(new Set(["cookies", "tabs"]));
  const owners = new Set();
  for (const [i, profile] of profiles.entries()) {
    const tabs = [1, 2].map((n) => Object.values(S().tabs).find((t) => t.url === `https://${profile.id}.test/${n}`));
    assert.ok(tabs.every(Boolean));
    assert.equal(new Set(tabs.map((t) => t.spaceId)).size, 2);
    const assigned = tabs.map((t) => S().spaces[t.spaceId].profileId);
    assert.equal(assigned[0], assigned[1]);
    if (i === 0) {
      assert.equal(tabs[0].spaceId, target);
      assert.equal(assigned[0], targetProfile);
    }
    owners.add(assigned[0]);
    assert.deepEqual(writes.filter((w) => w.token === `${profile.id}-vault`), [{ token: `${profile.id}-vault`, profile: S().profiles[assigned[0]].engineId }]);
  }
  assert.equal(owners.size, sourceCount);
  assert.equal(writes.length, sourceCount);
  assert.equal(Object.keys(S().profiles).length, beforeProfiles + sourceCount - 1);
});
