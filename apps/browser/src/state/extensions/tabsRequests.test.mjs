import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { engineProfile } from "../browser/model.ts";
import { openRequestedTab } from "./tabsRequests.ts";

const state = () => useBrowser.getState();

for (const action of ["adopt", "adoptInto"]) {
  test(`a native ${action} request keeps its Profile when it has no Spaces`, () => {
    state().hydrate({});
    state().createWindow({ url: "https://personal.test/" });
    const profileId = state().createProfile({ name: "Work" });
    const profile = state().profiles[profileId].engineId;
    openRequestedTab({ action, profile, adoptId: "tab:work", url: "https://work.test/", chromeWindow: "native-work", active: true, focused: false });
    const tab = Object.values(state().tabs).find((tab) => tab.url === "https://work.test/");
    assert.ok(tab);
    assert.equal(engineProfile(state(), tab.spaceId), profile);
    assert.equal(state().spaces[tab.spaceId].profileId, profileId);
    assert.equal(tab.page.adopt, "tab:work");
    if (action === "adoptInto") assert.equal(state().windows[tab.windowId].chromeWindow, "native-work");
  });
}

test("a native tab with an unknown Profile never opens under the default identity", () => {
  state().hydrate({});
  state().createWindow({ url: "https://personal.test/" });
  const before = state();
  openRequestedTab({ action: "adopt", profile: "unknown-profile", adoptId: "tab:unknown", url: "https://unknown.test/" });
  assert.deepEqual(state().tabs, before.tabs);
  assert.deepEqual(state().windows, before.windows);
});

test("an existing Chrome-created window adopts a tab under its owner after its current Space changes Profile", () => {
  state().hydrate({});
  const profileId = state().createProfile({ name: "Work" });
  const profile = state().profiles[profileId].engineId;
  const spaceId = state().createSpace({ name: "Work", profileId });
  const windowId = state().createWindow({ spaceId, chromeWindow: "native-work", url: "https://first.test/" });
  state().assignSpaceProfile(spaceId, "default");
  openRequestedTab({ action: "adoptInto", profile, chromeWindow: "native-work", adoptId: "tab:work", url: "https://work.test/", active: true, focused: false });
  const tab = Object.values(state().tabs).find((tab) => tab.url === "https://work.test/");
  assert.equal(tab.windowId, windowId);
  assert.equal(engineProfile(state(), tab.spaceId), profile);
  assert.equal(tab.page.adopt, "tab:work");
});
