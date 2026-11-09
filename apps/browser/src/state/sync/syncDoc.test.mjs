import assert from "node:assert/strict";
import { test } from "node:test";
const { DATA_TYPES, defaultTypes, typeSyncedFor } = await import("./syncDoc.ts");

test("a profile that shares another's data syncs only the types that aren't its data", () => {
  const types = defaultTypes();
  const shared = DATA_TYPES.filter((t) => typeSyncedFor(types, t.id, false)).map((t) => t.id);
  assert.deepEqual(shared, ["tabs", "pinned", "settings"]);
  assert.equal(typeSyncedFor({ ...types, bookmarks: false }, "bookmarks", true), false);
  assert.equal(typeSyncedFor(types, "extensions", true), true);
});
