import assert from "node:assert/strict";
import { test } from "node:test";
import { docs } from "../../test-native/index.ts";

docs.set(
  "shared-folders.json",
  JSON.stringify({
    version: 1,
    folders: {
      p: {
        good: { path: "/x/Good", addedAt: 1, base: [null, { kind: "link", key: "t1", file: "A.webloc", name: "A", url: "https://a.example/", id: null }, { kind: "dir", key: "g", file: "D", name: "D", children: [7, { kind: "link" }] }, "junk"] },
        bad: { path: "/x/Bad", addedAt: 1, base: "nope" },
      },
    },
  }),
);
const { sharedFolderOf } = await import("./store.ts");
const { knownNames } = await import("./local.ts");

test("malformed base entries are dropped on load, so a round never trips on them", () => {
  const good = sharedFolderOf("p", "good");
  assert.deepEqual(good.base, [
    { kind: "link", key: "t1", file: "A.webloc", name: "A", url: "https://a.example/", id: null },
    { kind: "dir", key: "g", file: "D", name: "D", children: [] },
  ]);
  assert.doesNotThrow(() => knownNames(good.base));
  assert.equal(sharedFolderOf("p", "bad"), undefined);
});
