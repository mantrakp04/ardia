import assert from "node:assert/strict";
import test from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { shownIn, useExtensions, windowExtensions } from "./extensionsStore.ts";

const id = (letter) => letter.repeat(32);
const extension = (letter, fields) => ({ id: id(letter), name: letter, enabled: true, incognito: false, incognitoSplit: false, pinned: true, ...fields });
const windows = {
  regular: { id: "regular", profileId: "default", kind: "main", tabIds: [], pinnedIds: [] },
  private: { id: "private", profileId: "incognito:p1", kind: "private", tabIds: [], pinnedIds: [] },
};
const state = { ...useBrowser.getState(), windows, windowOrder: ["regular", "private"] };

test("private windows show every enabled extension allowed in incognito, split or spanning", () => {
  useExtensions.setState({
    lists: {
      "": [
        extension("a", { incognito: true, incognitoSplit: true }),
        extension("b", { incognito: true, incognitoSplit: false }),
        extension("c", { incognito: false }),
        extension("d", { incognito: true, enabled: false }),
      ],
    },
  });
  assert.deepEqual(windowExtensions(state, "private").map((x) => x.name), ["a", "b"]);
  assert.deepEqual(windowExtensions(state, "regular").map((x) => x.name), ["a", "b", "c"]);
  assert.deepEqual(windowExtensions(state, undefined), []);
  useBrowser.setState({ windows, windowOrder: ["regular", "private"] });
  assert.equal(shownIn("private", id("b"))?.name, "b");
  assert.equal(shownIn("private", id("c")), undefined);
});
