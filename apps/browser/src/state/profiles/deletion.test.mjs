import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { profileDeletion } from "./deletion.ts";
import { requestDeleteProfile } from "./actions.ts";
import { deleteSpace } from "../browser/actions.ts";
import { shellNativeModules } from "../../test-native/index.ts";
const S = () => useBrowser.getState();
const dialogs = shellNativeModules.ArdiaDialogs;

test("used Profile deletion names two Spaces, confirms reassignment and preserves Space content", async () => {
  S().hydrate({});
  const next = S().createProfile({ name: "Work" });
  for (const name of ["Math", "Chemistry", "Art"]) S().createSpace({ name, profileId: "default" });
  const window = S().createWindow({ url: "https://saved.test/current" });
  const tab = S().windows[window].tabIds[0];
  S().pinTabs([tab], true, true);
  const prompts = [];
  const confirm = mock.method(dialogs, "confirm", async (options) => { prompts.push(options); return { confirmed: true }; });
  try {
    const choice = profileDeletion(S(), "default");
    assert.match(choice.message, /Art, Chemistry, and others/);
    assert.equal(choice.replacementId, next);
    assert.equal(await requestDeleteProfile("default"), true);
    assert.equal(prompts[0].confirmTitle, "Delete Anyway");
    assert.equal(prompts[0].cancelTitle, "Cancel");
    assert.ok(Object.values(S().spaces).every((space) => space.profileId === next));
    assert.equal(S().tabs[tab].url, "https://saved.test/current");
    assert.equal(S().tabs[tab].pin.as, "row");
    assert.equal(S().spaces.default.color, "plum");
  } finally { confirm.mock.restore(); }
});

test("cancelling leaves identities untouched and the alphabetical successor wraps", async () => {
  S().hydrate({});
  const last = S().createProfile({ name: "Zulu" });
  const space = S().createSpace({ name: "Lab", profileId: last });
  const confirm = mock.method(dialogs, "confirm", async () => ({ confirmed: false }));
  try {
    assert.equal(profileDeletion(S(), last).replacementId, "default");
    assert.equal(await requestDeleteProfile(last), false);
    assert.ok(S().profiles[last]);
    assert.equal(S().spaces[space].profileId, last);
  } finally { confirm.mock.restore(); }
});

test("last Profile, private sessions and the default or last Space explain why deletion is blocked", async () => {
  S().hydrate({});
  const prompts = [];
  const confirm = mock.method(dialogs, "confirm", async (options) => { prompts.push(options); return { confirmed: true }; });
  try {
    assert.equal(await requestDeleteProfile("default"), false);
    assert.match(prompts.at(-1).message, /at least one profile/);
    assert.equal(await deleteSpace("default"), false);
    assert.match(prompts.at(-1).message, /at least one space/);
    S().createProfile({ name: "Work" });
    S().createSpace({ name: "Projects" });
    assert.equal(await deleteSpace("default"), false);
    assert.match(prompts.at(-1).message, /default space/);
    S().createWindow({ kind: "private", spaceId: "default" });
    assert.equal(await requestDeleteProfile("default"), false);
    assert.match(prompts.at(-1).message, /private windows/);
    assert.ok(S().profiles.default);
  } finally { confirm.mock.restore(); }
});
