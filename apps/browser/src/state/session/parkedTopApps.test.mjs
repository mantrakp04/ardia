import assert from "node:assert/strict";
import { test } from "node:test";

const { useBrowser } = await import("../browser/store.ts");
const { sessionWithSpaces } = await import("../../lib/workspaceUpgrade.ts");
const { parseSession, flushPersistence, startPersistence } = await import("./persist.ts");
const { engineProfile } = await import("../browser/model.ts");
const stub = await import("../../test-native/index.ts");
const S = () => useBrowser.getState();
const profile = (id) => ({ id, name: id, color: "blue", icon: null, createdAt: 0 });

for (const version of [3, 8]) test(`a parked v${version} Top App keeps its original page history through saving and reopening`, () => {
  stub.docs.clear();
  const migrated = sessionWithSpaces({
    version,
    profiles: { default: profile("default"), work: profile("work") },
    profileOrder: ["default", "work"],
    settings: { defaultProfileId: "default" },
    windows: [{ id: "work-window", profileId: "work", tabIds: ["work-tab"], activeTabIds: { work: "work-tab" }, sidebarOpen: true, frame: null, createdAt: 0 }],
    windowOrder: ["work-window"],
    focusedWindowId: "work-window",
    tabs: [{ id: "work-tab", windowId: "work-window", profileId: "work", url: "https://work.test/", title: "Work", favicon: null, pin: null, page: { kind: "idle" }, muted: false, zoom: 1, createdAt: 0, lastActiveAt: 0 }],
    parkedPins: { default: { tabs: [{ id: "mail-pin", url: "https://mail.test/thread", title: "Mail", pinnedUrl: "https://mail.test/", restoreFrom: "native-mail" }], groups: [] } },
  });
  stub.docs.set("session.json", JSON.stringify(migrated));
  const stop = startPersistence();
  const parked = S().parkedTopApps.default[0];
  assert.notEqual(parked.id, "native-mail");
  assert.equal(parked.page.wake, "restore:native-mail");
  try {
    S().updateProfile("work", { name: "Work updated" });
    flushPersistence();
  } finally {
    stop();
  }
  const saved = stub.docs.get("session.json");
  assert.deepEqual(JSON.parse(saved).parkedTopApps.default[0].page, { kind: "asleep", wake: "restore:native-mail" });
  S().hydrate(parseSession(saved));
  const windowId = S().createWindow({ spaceId: "default" });
  const restored = S().tabs[parked.id];
  assert.equal(restored.windowId, windowId);
  assert.equal(restored.page.adopt, "restore:native-mail");
  assert.equal(restored.url, "https://mail.test/thread");
  assert.equal(engineProfile(S(), restored.spaceId), "");
});

test("a live parked Top App saves a restore key for its own native page", () => {
  stub.docs.clear();
  const stop = startPersistence();
  const windowId = S().createWindow({ url: "https://mail.test/" });
  const tabId = S().windows[windowId].tabIds[0];
  S().pinTabs([tabId], true);
  const work = S().createProfile({ name: "Work" });
  S().assignSpaceProfile("default", work);
  assert.equal(S().parkedTopApps.default[0].id, tabId);
  try {
    S().updateProfile(work, { name: "Work updated" });
    flushPersistence();
  } finally {
    stop();
  }
  assert.deepEqual(JSON.parse(stub.docs.get("session.json")).parkedTopApps.default[0].page, { kind: "asleep", wake: `restore:${tabId}` });
});

test("a saved parked Top App restores a complete idle live state", () => {
  S().hydrate({});
  const window = S().createWindow({ url: "https://mail.test/" });
  const tile = S().windows[window].tabIds[0];
  S().pinTabs([tile], true);
  const work = S().createProfile({ name: "Work" });
  S().assignSpaceProfile("default", work);
  const parked = S().parkedTopApps.default[0];
  useBrowser.setState({ live: {} });
  S().assignSpaceProfile("default", "default");
  assert.equal(S().tabs[parked.id].spaceId, "default");
  assert.equal(S().live[parked.id]?.isLoading, false);
});
