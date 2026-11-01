import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { paneNeeds } from "./paneData.ts";
import { goToSettingsPane, settingsBack, useSettingsNav } from "./settingsWindows.ts";

test("Settings Back can revisit a deleted Space without resolving a browsing Profile", () => {
  const state = () => useBrowser.getState();
  state().hydrate({});
  useSettingsNav.setState({ pane: "general", spaceId: null, detail: null, back: [], forward: [] });
  const space = state().createSpace({ name: "Temporary" });
  goToSettingsPane("spaces", space);
  goToSettingsPane("appearance");
  state().deleteSpace(space);
  settingsBack();
  const target = useSettingsNav.getState();
  assert.equal(target.spaceId, space);
  assert.deepEqual(paneNeeds(target.pane, target.spaceId), []);
  assert.doesNotThrow(() => paneNeeds("profiles", "deleted-profile"));
  const work = state().createProfile({ name: "Work" });
  assert.deepEqual(paneNeeds("passwords", work).map(([, args]) => args), [[state().profiles[work].engineId]]);
});

test("Space settings and explicit Profile settings resolve overlapping IDs separately", async () => {
  const S = () => useBrowser.getState();
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  S().assignSpaceProfile("default", work);
  const { openSettings, openProfileSettings } = await import("./settingsWindows.ts");
  openSettings("passwords", "default");
  assert.equal(useSettingsNav.getState().spaceId, work);
  assert.deepEqual(paneNeeds("passwords", useSettingsNav.getState().spaceId).map(([, args]) => args), [[work]]);
  openProfileSettings("passwords", "default");
  assert.equal(useSettingsNav.getState().spaceId, "default");
  assert.deepEqual(paneNeeds("passwords", "default").map(([, args]) => args), [[""]]);
  openSettings("general", "default");
  assert.deepEqual(paneNeeds("general", useSettingsNav.getState().spaceId).at(-1)[1], [work]);
});

test("explicit Profile and Space resolution preserves private identity and rejects unknown IDs", async () => {
  const S = () => useBrowser.getState();
  const { currentProfileId, profileIdForSpace } = await import("../profiles/current.ts");
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const privateWindow = S().createWindow({ kind: "private", spaceId: "default" });
  const privateSpace = S().windows[privateWindow].spaceId;
  S().assignSpaceProfile("default", work);
  assert.equal(currentProfileId("default"), "default");
  assert.equal(currentProfileId(), work);
  assert.equal(profileIdForSpace("default"), work);
  assert.equal(profileIdForSpace(privateSpace), "default");
  assert.throws(() => currentProfileId("unknown"), /unavailable/);
  assert.throws(() => profileIdForSpace("unknown"), /unavailable/);
});
