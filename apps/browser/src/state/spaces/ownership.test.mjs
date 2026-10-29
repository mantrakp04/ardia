import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { engineProfileForSpace, viewTabIds } from "../browser/model.ts";

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});

test("spaces share a chosen browsing identity while keeping themes and ordinary tabs separate", () => {
  reset();
  const projects = S().createSpace({ name: "Projects", profileId: "default", color: "blue" });
  const workProfile = S().createProfile({ name: "Work" });
  const work = S().createSpace({ name: "Work space", profileId: workProfile, color: "green" });
  const window = S().createWindow({ url: "https://school.test" });
  S().switchSpace(window, projects);
  S().newTab(window, { url: "https://projects.test" });
  assert.equal(engineProfileForSpace("default"), engineProfileForSpace(projects));
  assert.notEqual(engineProfileForSpace(work), engineProfileForSpace(projects));
  assert.ok(viewTabIds(S(), window, "default").every((id) => S().tabs[id].url !== "https://projects.test"));
  assert.equal(S().spaces.default.color, "plum");
  assert.equal(S().spaces[projects].color, "blue");
  assert.equal(S().profiles.default.theme, undefined);
  S().setDefaultSpace(projects);
  const created = S().createWindow();
  assert.equal(S().windows[created].spaceId, projects);
});

test("deleting a space does not delete its browsing profile, and used profiles cannot be deleted", () => {
  reset();
  const profile = S().createProfile({ name: "Work" });
  const workspace = S().createSpace({ name: "Work", profileId: profile });
  S().deleteProfile(profile);
  assert.ok(S().profiles[profile]);
  S().deleteSpace(workspace);
  assert.ok(S().profiles[profile]);
  assert.deepEqual(S().orphanedProfileData, []);
  S().deleteProfile(profile);
  assert.equal(S().profiles[profile], undefined);
  assert.deepEqual(S().orphanedProfileData, [profile]);
});

test("Top Apps share within a profile while saved rows stay in their space", () => {
  reset();
  const projects = S().createSpace({ name: "Projects", profileId: "default" });
  const window = S().createWindow({ url: "https://mail.test" });
  const tile = viewTabIds(S(), window)[0];
  S().pinTabs([tile], true, false);
  S().switchSpace(window, projects);
  const shared = viewTabIds(S(), window).map((id) => S().tabs[id]).filter((tab) => tab.pin?.as === "tile");
  assert.equal(shared.length, 1);
  assert.equal(shared[0].pinnedUrl, "https://mail.test");
  const row = S().newTab(window, { url: "https://saved.test" });
  S().pinTabs([row], true, true);
  assert.ok(!viewTabIds(S(), window, "default").some((id) => S().tabs[id].url === "https://saved.test"));
});
