import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");

const { useBrowser } = await import("../browser/store.ts");
const { startHistory, reloadHistory } = await import("../history/engineSync.ts");
const { startBookmarks } = await import("../bookmarks/engineSync.ts");
const startup = await import("./startupEngineProfiles.ts");

const { configureProfileStartup } = await import("./startupEngineProfiles.ts");
configureProfileStartup({ loadProfilesWhenOpened: true });
const { startProfileLoading } = await import("./profileLoading.ts");

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

test("experiment startup loads selected services and switching demand-loads the next profile", async () => {
  assert.equal(startup.selectedProfileReads, true);
  const state = () => useBrowser.getState();
  state().hydrate({});
  const work = state().createProfile({ name: "Work" });
  const dormant = state().createProfile({ name: "Dormant" });
  const windowId = state().createWindow({ profileId: "default" });
  const stops = [startProfileLoading(), startHistory(), startBookmarks()];
  try {
    await settle();
    assert.deepEqual(stub.historyWatches, [""]);
    assert.deepEqual(Object.keys(state().bookmarksReady), [""]);
    state().switchProfile(windowId, work);
    await settle();
    assert.deepEqual(stub.historyWatches, ["", work]);
    assert.deepEqual(Object.keys(state().bookmarksReady), ["", work]);
    assert.ok(!stub.historyWatches.includes(dormant));
    await reloadHistory();
    assert.ok(!stub.historyWatches.includes(dormant), "reload preserves unopened profiles");
  } finally {
    stops.forEach((stop) => stop());
  }
});
