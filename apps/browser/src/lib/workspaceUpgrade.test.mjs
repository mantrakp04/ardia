import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionWithSpaces, syncWithSpaces, upgradeWorkspaceDocuments } from "./workspaceUpgrade.ts";

const profile = (id, name, extra = {}) => ({ id, name, color: "blue", icon: null, createdAt: 1, ...extra });
const legacy = () => ({ version: 3, profiles: {
  default: profile("default", "Personal"), school: profile("school", "School", { dataId: "default", theme: { mode: "custom" } }), work: profile("work", "Work"),
}, profileOrder: ["school", "work", "default"], settings: { defaultProfileId: "school", profilesFollowAppearance: false, profileSwitcherIcons: true, shortcuts: { nextProfile: ["ctrl+right"] } }, windows: [], tabs: [], groups: [], lastProfileId: "school" });

test("shared identities become one Profile while every workspace keeps its ID, theme and order", () => {
  const source = legacy();
  const result = sessionWithSpaces(source);
  assert.deepEqual(Object.keys(result.profiles).sort(), ["default", "work"]);
  assert.equal(result.profiles.default.name, "Personal");
  assert.equal(result.profiles.default.engineId, "");
  assert.equal(result.spaces.school.profileId, "default");
  assert.deepEqual(result.spaces.school.theme, source.profiles.school.theme);
  assert.deepEqual(result.spaceOrder, source.profileOrder);
  assert.equal(result.settings.defaultSpaceId, "school");
  assert.equal(result.settings.defaultProfileId, undefined);
  assert.equal(result.settings.spacesFollowAppearance, false);
  assert.equal(result.settings.profilesFollowAppearance, undefined);
  assert.deepEqual(result.settings.shortcuts.nextSpace, ["ctrl+right"]);
  assert.deepEqual(sessionWithSpaces(result), result);
  assert.equal(source.profiles.school.dataId, "default");
});

test("a deleted data owner keeps its directory, and equal names never merge independent identities", () => {
  const source = legacy();
  delete source.profiles.default;
  source.profiles.work.name = "School";
  const result = sessionWithSpaces(source);
  assert.equal(result.profiles.default.engineId, "");
  assert.equal(result.spaces.school.profileId, "default");
  assert.equal(result.spaces.work.profileId, "work");
  assert.equal(Object.keys(result.profiles).length, 2);
});

test("deduplicating mirrored Top Apps preserves other navigated pages as ordinary tabs", () => {
  const source = legacy();
  source.tabs = [
    { id: "a", profileId: "school", windowId: "w1", pinned: true, pinKey: "same", pinnedUrl: "https://mail.test", url: "https://mail.test/message-a", lastActiveAt: 10, wakeAdoptId: "restore:a" },
    { id: "b", profileId: "school", windowId: "w2", pinned: true, pinKey: "same", pinnedUrl: "https://mail.test", url: "https://mail.test/message-b", lastActiveAt: 20, wakeAdoptId: "restore:b" },
    { id: "c", profileId: "default", windowId: "w1", pinned: true, url: "https://mail.test", lastActiveAt: 30 },
  ];
  const result = sessionWithSpaces(source);
  assert.equal(result.topApps.default.length, 2);
  assert.equal(result.tabs[0].pin, null);
  assert.equal(result.tabs[0].page.wake, "restore:a");
  assert.equal(result.tabs[0].url, "https://mail.test/message-a");
  assert.equal(result.tabs[1].pin.as, "tile");
  assert.equal(result.tabs[1].spaceId, "school");
});

test("upgrade backs up source documents before writing their replacements", () => {
  const before = JSON.stringify(legacy());
  const files = new Map([["session.json", before], ["live.json", JSON.stringify({ version: 1, folders: { f: { id: "f", profileId: "school" } } })]]);
  upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  assert.equal(files.get("session.json.before-spaces-v10"), before);
  assert.equal(JSON.parse(files.get("session.json")).version, 10);
  assert.equal(JSON.parse(files.get("live.json")).folders.f.spaceId, "school");
  const after = new Map(files);
  upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  assert.deepEqual(files, after);
});

test("an interrupted upgrade resumes from its prepared transaction", () => {
  for (const failAt of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const files = new Map([["session.json", JSON.stringify(legacy())], ["live.json", JSON.stringify({ version: 1, folders: {} })], ["sync.json", JSON.stringify({ v: 1, profiles: { default: { enabled: true, syncId: "owner" } } })]]);
    let writes = 0;
    const read = (name) => files.get(name) ?? null;
    assert.throws(() => upgradeWorkspaceDocuments({ read, write: (name, value) => { if (++writes === failAt) throw new Error("interrupted"); files.set(name, value); } }));
    upgradeWorkspaceDocuments({ read, write: (name, value) => files.set(name, value) });
    assert.equal(JSON.parse(files.get("session.json")).version, 10);
    assert.equal(JSON.parse(files.get("live.json")).version, 2);
    assert.equal(JSON.parse(files.get("sync.json")).v, 2);
    assert.equal(JSON.parse(files.get("workspace-upgrade-v10.json")).state, "complete");
  }
});

test("parked tiles move into the Profile even with no open windows, preserving restorable pages and rows", () => {
  const source = legacy();
  source.parkedPins = { school: { tabs: [
    { id: "mail", url: "https://mail.test/message", pinnedUrl: "https://mail.test", title: "Mail", restoreFrom: "old-page" },
    { id: "row", url: "https://saved.test", pinnedAsRow: true },
  ], groups: [] } };
  const result = sessionWithSpaces(source, { profiles: { school: { syncId: "school-sync" } } });
  assert.equal(result.topApps.default[0].key, "school-sync::mail");
  assert.equal(result.parkedTopApps.default[0].page.wake, "restore:old-page");
  assert.equal(result.parkedTopApps.default[0].url, "https://mail.test/message");
  assert.deepEqual(result.parkedPins.school.tabs.map((tab) => tab.id), ["row"]);
  assert.deepEqual(sessionWithSpaces(result), result);
});

test("merging identities preserves separate data, workspace and Top Apps sync consent", () => {
  const session = sessionWithSpaces(legacy());
  const result = syncWithSpaces({ v: 1, profiles: { default: { syncId: "owner", enabled: true }, school: { syncId: "school", enabled: false, retire: true }, work: { syncId: "work", enabled: true } } }, session);
  assert.equal(result.profiles.default.enabled, true);
  assert.equal(result.profiles.default.topAppsEnabled, false);
  assert.equal(result.spaces.school.enabled, false);
  assert.equal(result.spaces.school.retire, true);
  assert.equal(result.protocolReady, false);
  assert.equal(result.profiles.work.topAppsEnabled, true);
});

test("future or invalid sessions are kept without any writes", () => {
  for (const value of [{ version: 99 }, { version: 3, profiles: {} }, { version: 4, profiles: {}, spaces: {} }]) {
    const source = JSON.stringify(value);
    const writes = [];
    assert.throws(() => upgradeWorkspaceDocuments({ read: (name) => name === "session.json" ? source : null, write: (...args) => writes.push(args) }));
    assert.deepEqual(writes, []);
  }
});

test("upstream v4 and the earlier Spaces v4 upgrade to one v10 format", () => {
  const upstream = { ...legacy(), version: 4, settings: { ...legacy().settings, mutedSites: ["mail.test"] }, tabs: [{ id: "a", profileId: "school", windowId: "w", url: "https://mail.test/", muted: true }] };
  const migrated = sessionWithSpaces(upstream);
  assert.equal(migrated.version, 10);
  assert.equal(migrated.tabs[0].muted, true, "upstream v4 already stores only the tab's own mute");
  const earlier = { ...migrated, version: 4 };
  const files = new Map([["session.json", JSON.stringify(earlier)]]);
  upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  const current = JSON.parse(files.get("session.json"));
  assert.equal(current.version, 10);
  assert.deepEqual(current.profiles, earlier.profiles);
  assert.deepEqual(current.spaces, earlier.spaces);
  assert.deepEqual(current.topApps, earlier.topApps);
  assert.equal(current.tabs[0].muted, false, "the earlier Spaces build still stored the inherited site mute");
  assert.equal(files.get("session.json.before-spaces-v10"), JSON.stringify(earlier));
  assert.deepEqual(sessionWithSpaces(current), current);
});

test("a prepared v4 Spaces upgrade finishes before the v10 transaction", () => {
  const before = JSON.stringify(legacy());
  const v4 = JSON.stringify({ ...sessionWithSpaces(legacy()), version: 4 });
  const journal = { state: "prepared", documents: { "session.json": { before, after: v4 } } };
  const files = new Map([["session.json", before], ["workspace-upgrade-v4.json", JSON.stringify(journal)]]);
  const io = { read: (name) => files.get(name) ?? null, write: (name, value) => files.set(name, value) };
  upgradeWorkspaceDocuments(io);
  assert.equal(files.get("session.json.before-spaces-v4"), before);
  assert.equal(files.get("session.json.before-spaces-v10"), v4);
  assert.equal(JSON.parse(files.get("session.json")).version, 10);
  const after = new Map(files);
  upgradeWorkspaceDocuments(io);
  assert.deepEqual(files, after);
});

test("the earlier Spaces v4 converts inherited site mutes on parked Top Apps", () => {
  const source = {
    ...sessionWithSpaces(legacy()),
    version: 4,
    settings: { ...sessionWithSpaces(legacy()).settings, mutedSites: ["mail.test"] },
    parkedTopApps: { default: [
      { id: "site-muted", url: "https://mail.test/", spaceId: "school", muted: true },
      { id: "own-muted", url: "https://other.test/", spaceId: "school", muted: true },
    ] },
  };
  const migrated = sessionWithSpaces(source);
  assert.equal(migrated.parkedTopApps.default[0].muted, false);
  assert.equal(migrated.parkedTopApps.default[1].muted, true);
  assert.equal(source.parkedTopApps.default[0].muted, true);
});

test("an invalid old journal or future folder format blocks before any writes", () => {
  const before = JSON.stringify(legacy());
  const after = JSON.stringify({ ...sessionWithSpaces(legacy()), version: 4 });
  const prepared = { state: "prepared", documents: { "session.json": { before, after } } };
  for (const additions of [
    [["workspace-upgrade-v4.json", JSON.stringify({ state: "invalid", documents: {} })]],
    [["workspace-upgrade-v4.json", JSON.stringify(prepared)], ["live.json", JSON.stringify({ version: 9 })]],
  ]) {
    const files = new Map([["session.json", before], ...additions]);
    const copy = new Map(files);
    assert.throws(() => upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: () => assert.fail("must not write") }));
    assert.deepEqual(files, copy);
  }
});

for (const version of [5, 6, 7, 8, 9]) test(`upstream v${version} keeps tab restore IDs, tile folders and split placement when separating Spaces`, () => {
  const source = legacy();
  source.version = version;
  source.tabs = [{ id: "mail", windowId: "w", profileId: "school", url: "https://mail.test/", title: "Mail", page: { kind: "asleep", wake: "restore:original" }, ...(version >= 6 ? { pin: { as: "tile", folder: { id: "apps", name: "Apps" } } } : { pinned: true, tileFolder: { id: "apps", name: "Apps" } }) }];
  source.splits = version >= 7 ? [{ id: "s", windowId: "w", orientation: "horizontal", slots: [{ tabId: "mail", size: 0.5 }, { tabId: "other", size: 0.5 }] }] : [{ id: "s", windowId: "w", orientation: "horizontal", tabIds: ["mail", "other"], sizes: [0.5, 0.5] }];
  const files = new Map([["session.json", JSON.stringify(source)]]);
  upgradeWorkspaceDocuments({ read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  const migrated = JSON.parse(files.get("session.json"));
  assert.equal(migrated.version, 10);
  assert.equal(migrated.tabs[0].spaceId, "school");
  assert.deepEqual(migrated.tabs[0].page, { kind: "asleep", wake: "restore:original" });
  assert.deepEqual(migrated.tabs[0].pin, { as: "tile", folder: { id: "apps", name: "Apps" } });
  assert.equal(migrated.topApps.default[0].tileFolder.id, "apps");
  assert.deepEqual(migrated.splits[0].slots, [{ tabId: "mail", size: 0.5 }, { tabId: "other", size: 0.5 }]);
  assert.equal(files.get("session.json.before-spaces-v10"), JSON.stringify(source));
});

test("a prepared earlier Spaces v5 transaction finishes before the v10 transaction", () => {
  const before = JSON.stringify(legacy());
  const earlier = JSON.stringify({ ...sessionWithSpaces(legacy()), version: 5 });
  const files = new Map([["session.json", before], ["workspace-upgrade-v5.json", JSON.stringify({ state: "prepared", documents: { "session.json": { before, after: earlier } } })]]);
  upgradeWorkspaceDocuments({ read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  assert.equal(JSON.parse(files.get("workspace-upgrade-v5.json")).state, "complete");
  assert.equal(JSON.parse(files.get("workspace-upgrade-v10.json")).state, "complete");
  assert.equal(files.get("session.json.before-spaces-v10"), earlier);
});

for (const separate of [false, true]) test(`v8 ${separate ? "Spaces" : "upstream"} preserves explicit settings choices in v10`, () => {
  const source = separate ? sessionWithSpaces(legacy()) : legacy();
  source.version = 8;
  source.settingsMeta = { chosen: [separate ? "defaultSpaceId" : "defaultProfileId", "newTabPosition"], inferred: ["tabLayout"] };
  const files = new Map([["session.json", JSON.stringify(source)]]);
  const io = { read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) };
  upgradeWorkspaceDocuments(io);
  const upgraded = JSON.parse(files.get("session.json"));
  assert.equal(upgraded.version, 10);
  assert.deepEqual(upgraded.settingsMeta, { chosen: ["defaultSpaceId", "newTabPosition"], inferred: ["tabLayout"] });
  assert.equal(upgraded.settings.chosen, undefined);
  const complete = new Map(files);
  upgradeWorkspaceDocuments(io);
  assert.deepEqual(files, complete);
});

test("a prepared earlier Spaces v8 transaction finishes before the v10 transaction", () => {
  const before = JSON.stringify(legacy());
  const earlier = JSON.stringify({ ...sessionWithSpaces(legacy()), version: 8 });
  const files = new Map([["session.json", before], ["workspace-upgrade-v8.json", JSON.stringify({ state: "prepared", documents: { "session.json": { before, after: earlier } } })]]);
  upgradeWorkspaceDocuments({ read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  assert.equal(JSON.parse(files.get("workspace-upgrade-v8.json")).state, "complete");
  assert.equal(JSON.parse(files.get("session.json")).version, 10);
  assert.equal(files.get("session.json.before-spaces-v10"), earlier);
});

for (const separate of [false, true]) test(`v9 ${separate ? "Spaces" : "upstream"} preserves pin-choice ordering while upgrading to v10`, () => {
  const source = separate ? sessionWithSpaces(legacy()) : legacy();
  source.version = 9;
  source.pinChoices = { school: { first: 1900000000000, second: "00000zzzz.0001.device" } };
  const files = new Map([["session.json", JSON.stringify(source)]]);
  const io = { read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) };
  upgradeWorkspaceDocuments(io);
  const upgraded = JSON.parse(files.get("session.json"));
  assert.equal(upgraded.version, 10);
  assert.equal(typeof upgraded.pinChoices.school.first, "string");
  assert.equal(upgraded.pinChoices.school.second, source.pinChoices.school.second);
  const complete = new Map(files);
  upgradeWorkspaceDocuments(io);
  assert.deepEqual(files, complete);
});

test("a prepared earlier Spaces v9 transaction finishes before the v10 transaction", () => {
  const before = JSON.stringify(legacy());
  const earlier = JSON.stringify({ ...sessionWithSpaces(legacy()), version: 9 });
  const files = new Map([["session.json", before], ["workspace-upgrade-v9.json", JSON.stringify({ state: "prepared", documents: { "session.json": { before, after: earlier } } })]]);
  upgradeWorkspaceDocuments({ read: name => files.get(name) ?? null, write: (name, value) => files.set(name, value) });
  assert.equal(JSON.parse(files.get("workspace-upgrade-v9.json")).state, "complete");
  assert.equal(JSON.parse(files.get("session.json")).version, 10);
  assert.equal(files.get("session.json.before-spaces-v10"), earlier);
});

for (const completed of [false, true]) test(`current sessions leave repairable references to hydration, completed journal: ${completed}`, () => {
  const saved = sessionWithSpaces(legacy());
  saved.settings.defaultSpaceId = "missing";
  saved.spaces.school.profileId = "missing";
  saved.tabs.push({ id: "orphan", spaceId: "missing" });
  const files = new Map([["session.json", JSON.stringify(saved)]]);
  if (completed) files.set("workspace-upgrade-v10.json", JSON.stringify({ state: "complete", documents: { "session.json": { before: "{}", after: "{}" } } }));
  const before = new Map(files);
  assert.doesNotThrow(() => upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: (name, value) => files.set(name, value) }));
  assert.deepEqual(files, before);
  files.set("session.json", JSON.stringify({ version: 99 }));
  assert.throws(() => upgradeWorkspaceDocuments({ read: (name) => files.get(name) ?? null, write: () => assert.fail("unexpected write") }), /newer Ardia/);
});
