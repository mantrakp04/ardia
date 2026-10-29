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
