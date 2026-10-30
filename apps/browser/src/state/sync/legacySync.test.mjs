import assert from "node:assert/strict";
import { test } from "node:test";

const writes = [];
globalThis.acTestNativeModules = { ArdiaSync: {
  openLocal: async (value) => value.startsWith("sealed:") ? value.slice(7) : null,
  read: async () => ({ files: [], present: [], pending: [], damaged: [] }),
  write: async (...args) => { writes.push(args); throw new Error("Legacy scope must stay read-only"); },
  remove: async () => { throw new Error("Legacy files must stay intact"); },
} };

const { docs } = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { Clock, canonical, emptyScope } = await import("@ardia/sync");
const { importLegacySync } = await import("./legacySync.ts");
const { APP_SCOPE, emptyDoc } = await import("./syncDoc.ts");
const S = () => useBrowser.getState();

function fixture({ data = true, tiles = true, school = true, settings = true } = {}) {
  docs.clear();
  S().hydrate({});
  const child = S().createSpace({ name: "School", profileId: "default" });
  const clock = new Clock("old-device");
  const scope = (values) => ({ ...emptyScope(), records: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { h: clock.tick(), v: value, o: ["old-device", 1] }])), base: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, canonical(value)])) });
  const app = scope({ "prof:owner": { n: "Personal", c: "plum", i: null, d: true }, "prof:school": { n: "School", c: "blue", i: null }, "share:school": { o: "owner" }, "set:warnBeforeQuitting": { v: false } });
  const owner = scope({ "h:https://history.test": { t: "History", n: 1, vt: [Date.now()] }, "pin:t:remote-tile": { g: null, u: "https://remote.test", t: null, i: null, ti: "Remote", pos: "V" }, "tilefold:remote-tile": { f: "folder" }, "tilefold:n:folder": { n: "Projects" } });
  const childScope = scope({ "pin:t:row": { g: null, u: "https://row.test", t: null, i: null, ti: "Row", pos: "V" }, "pinrow:row": 1 });
  docs.set("sync-state.nns", `sealed:${JSON.stringify({ covers: 0, scopes: { app, "p:owner": owner, "p:school": childScope } })}`);
  const doc = { ...emptyDoc(), enabled: true, folder: "/fixture", deviceId: "this-device", protocolReady: false, legacyPending: true, profiles: { default: { syncId: "owner", enabled: data, topAppsEnabled: tiles } }, spaces: { default: { syncId: "owner", enabled: true }, [child]: { syncId: "school", enabled: school } } };
  doc.types.settings = settings;
  return { doc, owner, child };
}

test("legacy upgrade imports remote-only Top Apps and preserves old data baselines without writing old scopes", async () => {
  const { doc, owner } = fixture();
  owner.base["h:https://history.test"] = canonical({ t: "Previous", n: 1, vt: [1] });
  const stored = JSON.parse(docs.get("sync-state.nns").slice(7));
  stored.scopes["p:owner"] = owner;
  docs.set("sync-state.nns", `sealed:${JSON.stringify(stored)}`);
  const before = new Map(docs);
  await importLegacySync(doc);
  assert.equal(S().topApps.default[0].key, "owner::remote-tile");
  assert.equal(S().topApps.default[0].tileFolder.name, "Projects");
  assert.equal(doc.scopes["data:owner"].base["h:https://history.test"], owner.base["h:https://history.test"]);
  assert.ok(doc.scopes["space:school"].records["pin:t:row"]);
  assert.equal(doc.scopes["space:owner"].records["pin:t:remote-tile"], undefined);
  assert.equal(doc.legacyPending, undefined);
  assert.deepEqual(docs, before);
  assert.equal(writes.length, 0);
});

test("legacy upgrade respects independent data, tile, workspace and global settings opt-outs", async () => {
  const { doc } = fixture({ data: false, tiles: false, school: false, settings: false });
  await importLegacySync(doc);
  assert.equal(doc.scopes["data:owner"], undefined);
  assert.equal(doc.scopes["space:school"], undefined);
  assert.equal(doc.scopes[APP_SCOPE].records["prof:school"], undefined);
  assert.equal(doc.scopes[APP_SCOPE].records["set:warnBeforeQuitting"], undefined);
  assert.deepEqual(S().topApps.default ?? [], []);
});

test("an unreadable encrypted legacy checkpoint stops conversion and retains its source", async () => {
  const { doc } = fixture();
  docs.set("sync-state.nns", "unreadable");
  await assert.rejects(importLegacySync(doc), /could not be opened/);
  assert.equal(doc.legacyPending, true);
  assert.equal(docs.get("sync-state.nns"), "unreadable");
  assert.equal(writes.length, 0);
});

test("legacy tile conversion keeps unrelated sidebar rows and groups with matching ID suffixes", async () => {
  const { doc } = fixture();
  const stored = JSON.parse(docs.get("sync-state.nns").slice(7));
  const owner = stored.scopes["p:owner"];
  const source = owner.records["pin:t:remote-tile"];
  for (const [key, value] of [["pin:t:another-remote-tile", { ...source.v, u: "https://kept-row.test" }], ["pinrow:another-remote-tile", 1], ["pgh:group-remote-tile", { n: "Group" }]]) {
    owner.records[key] = { ...source, v: value };
    owner.base[key] = canonical(value);
  }
  docs.set("sync-state.nns", `sealed:${JSON.stringify(stored)}`);
  await importLegacySync(doc);
  const next = doc.scopes["space:owner"];
  assert.equal(next.records["pin:t:another-remote-tile"]?.v?.u, "https://kept-row.test");
  assert.equal(next.records["pinrow:another-remote-tile"]?.v, 1);
  assert.deepEqual(next.records["pgh:group-remote-tile"]?.v, { n: "Group" });
  assert.equal(next.records["pin:t:remote-tile"], undefined);
});
