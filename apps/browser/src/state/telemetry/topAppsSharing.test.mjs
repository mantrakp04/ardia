import assert from "node:assert/strict";
import { after, test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install", crashCursor: 0, lastVersion: "0.2.44", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startUsage } = await import("./usage.ts");
const { profileTopAppsAdapter } = await import("../sync/profileAdapters.ts");
const { addLinkedProfile, appScopeOf, linkProfiles } = await import("../sync/profileLinks.ts");
after(() => client.setSharing(false, "settings"));

const S = () => useBrowser.getState();
const NAMES = ["top_apps_sharing", "top_apps_sharing_synced", "top_apps_mirrored"];

async function recorded(name) {
  await client.saveQueueNow();
  const saved = stub.docs.get("telemetry-queue.json");
  const events = saved ? JSON.parse(saved).events : [];
  return events.filter((e) => e.event === name);
}

const countsOf = (event, keys) => Object.fromEntries(keys.map((key) => [key, event.properties[key]]));

function twoSharingProfiles({ sharing }) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  S().newTab(w, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  if (sharing) S().updateProfile("default", { shareTopApps: true });
  const work = S().createProfile({ shareTopApps: sharing, name: "Work", shareWith: "default" });
  return { w, work };
}

const syncedDoc = () => ({
  v: 1,
  enabled: true,
  folder: null,
  deviceId: null,
  clock: null,
  types: {},
  profiles: {},
  scopes: {},
  lastSyncedAt: null,
  setupAt: null,
  joining: true,
});

const remoteRecord = (v) => ({ h: "h", v, o: ["device", 1] });

test("records noted before telemetry starts are held, and written with the launch counts once startUsage runs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { work } = twoSharingProfiles({ sharing: false });
  S().updateProfile("default", { shareTopApps: true });
  const adapter = profileTopAppsAdapter(() => ({ [work]: { syncId: "work-sync" } }));

  adapter.apply(new Map([["pta:work-sync", { on: true }]]), new Set(["pta:work-sync"]));
  assert.equal(S().profiles[work].shareTopApps, true);
  for (const name of NAMES) assert.deepEqual(await recorded(name), [], `${name} waits for telemetry to start`);

  startUsage();
  for (let turn = 0; turn < 100 && !(await recorded("top_apps_sharing")).length; turn++) await new Promise(setImmediate);

  const [launch] = await recorded("top_apps_sharing");
  assert.deepEqual(countsOf(launch, ["profile_count", "sharing_profiles", "merge_recorded", "from_version"]), {
    profile_count: 2,
    sharing_profiles: 2,
    merge_recorded: true,
    from_version: "0.2.44",
  });

  const synced = await recorded("top_apps_sharing_synced");
  assert.equal(synced.length, 1);
  assert.deepEqual(countsOf(synced[0], ["path", "on", "profile_count", "sharing_profiles"]), { path: "synced_record", on: true, profile_count: 2, sharing_profiles: 2 });

  const mirrored = await recorded("top_apps_mirrored");
  assert.ok(mirrored.length >= 1, "the pass that copied the tile into Work was recorded");
});

test("a synced record that leaves a profile's Share Top Apps as it is records nothing", async () => {
  const { work } = twoSharingProfiles({ sharing: true });
  const before = (await recorded("top_apps_sharing_synced")).length;
  const adapter = profileTopAppsAdapter(() => ({ [work]: { syncId: "work-sync" } }));

  adapter.apply(new Map([["pta:work-sync", { on: true }]]), new Set(["pta:work-sync"]));
  adapter.apply(new Map([["pta:work-sync", { on: true }]]), new Set());
  assert.equal((await recorded("top_apps_sharing_synced")).length, before);

  adapter.apply(new Map([["pta:work-sync", { on: false }]]), new Set(["pta:work-sync"]));
  const after = await recorded("top_apps_sharing_synced");
  assert.equal(after.length, before + 1);
  assert.deepEqual(countsOf(after.at(-1), ["path", "on", "profile_count", "sharing_profiles"]), { path: "synced_record", on: false, profile_count: 2, sharing_profiles: 1 });
});

test("linking a profile or creating one from a synced record names its path and counts only", async () => {
  S().hydrate({});
  const before = (await recorded("top_apps_sharing_synced")).length;
  const doc = syncedDoc();
  const app = appScopeOf(doc);
  app.records["prof:remote-default"] = remoteRecord({ n: "Remote Personal", c: "blue", i: null, d: true });
  app.records["pta:remote-default"] = remoteRecord({ on: true });
  linkProfiles(doc, app);
  assert.equal(S().profiles.default.shareTopApps, true);

  app.records["pta:remote-extra"] = remoteRecord({ on: true });
  addLinkedProfile(doc, "remote-extra", { n: "Remote Extra", c: "red", i: null }, null);
  addLinkedProfile(doc, "remote-quiet", { n: "Remote Quiet", c: "red", i: null }, null);

  const synced = (await recorded("top_apps_sharing_synced")).slice(before);
  assert.deepEqual(
    synced.map((e) => countsOf(e, ["path", "on", "profile_count", "sharing_profiles"])),
    [
      { path: "link_profiles", on: true, profile_count: 1, sharing_profiles: 1 },
      { path: "linked_profile_created", on: true, profile_count: 2, sharing_profiles: 2 },
    ],
  );
});

test("a pass that copies Top Apps into another profile records the circles and tiles, and a pass with sharing off records nothing", async () => {
  S().hydrate({});
  const before = (await recorded("top_apps_mirrored")).length;
  twoSharingProfiles({ sharing: false });
  assert.equal((await recorded("top_apps_mirrored")).length, before, "no profile shares, so nothing is copied or recorded");

  twoSharingProfiles({ sharing: true });
  const mirrored = (await recorded("top_apps_mirrored")).slice(before);
  assert.ok(mirrored.length >= 1);
  assert.deepEqual(countsOf(mirrored[0], ["circles", "joining_circles", "circles_changed", "profiles_changed", "tiles", "from_sync"]), {
    circles: 1,
    joining_circles: 1,
    circles_changed: 1,
    profiles_changed: 1,
    tiles: 1,
    from_sync: false,
  });
});

test("none of the records carry a URL, a title or a profile name", async () => {
  twoSharingProfiles({ sharing: true });
  const events = (await Promise.all(NAMES.map(recorded))).flat();
  assert.ok(events.length > 0);
  for (const event of events) {
    const text = JSON.stringify(event);
    for (const secret of ["mail.com", "a.com", "Work", "Remote", "Personal", "https://"]) assert.ok(!text.includes(secret), `${event.event} must not contain ${secret}`);
  }
});
