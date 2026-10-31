import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { openUrl, openLinks } from "./actions.ts";

const S = () => useBrowser.getState();
for (const mode of ["window", "incognito"]) for (const folder of [false, true]) test(`bookmark ${folder ? "folder" : "page"} ${mode} retains the source private identity`, async () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const space = S().createSpace({ name: "Projects", profileId: work });
  const parent = S().createWindow({ kind: "private", spaceId: space });
  const expected = S().windows[parent].incognitoEngineId;
  S().assignSpaceProfile(space, "default");
  if (folder) await openLinks([{ url: "https://one.test/" }, { url: "https://two.test/" }], parent, mode);
  else openUrl("https://one.test/", parent, mode);
  const child = Object.values(S().windows).find((w) => w.id !== parent);
  assert.equal(child?.kind, "private");
  assert.equal(child.incognitoEngineId, expected);
  assert.ok(child.spaceId.includes(space));
});
