import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { engineProfile, privateSession, viewTabIds } from "../browser/model.ts";
import { openFromPage } from "./openFromPage.ts";

const state = () => useBrowser.getState();

for (const disposition of ["window", "incognito"]) {
  for (const startsInWork of [false, true]) {
    test(`a private ${disposition} child keeps ${startsInWork ? "Work" : "Personal"}'s frozen identity after its source Space is reassigned`, () => {
      state().hydrate({});
      const work = state().createProfile({ name: "Work" });
      const space = state().createSpace({ name: "Temporary", profileId: startsInWork ? work : "default" });
      const parent = state().createWindow({ kind: "private", spaceId: space, url: "https://parent.test/" });
      const parentSpace = state().windows[parent].spaceId;
      const expected = privateSession(state(), parentSpace);
      state().assignSpaceProfile(space, startsInWork ? "default" : work);
      openFromPage({ url: "https://child.test/", disposition }, { windowId: parent, spaceId: parentSpace, tabId: viewTabIds(state(), parent)[0] });
      const child = Object.values(state().windows).find((window) => window.id !== parent);
      assert.ok(child?.kind === "private");
      assert.equal(child.incognitoEngineId, expected);
      assert.equal(privateSession(state(), child.spaceId), expected);
      assert.equal(engineProfile(state(), child.spaceId), `incognito:${child.id}@${expected}`);
    });
  }
}
