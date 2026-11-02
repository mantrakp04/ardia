import assert from "node:assert/strict";
import { test } from "node:test";
const { DATA_TYPES, defaultTypes, typeSyncedFor } = await import("./syncDoc.ts");

test("every sync type is listed once, on by default, in the Sync pane's order", () => {
  assert.deepEqual(
    DATA_TYPES.map((t) => t.id),
    ["bookmarks", "history", "tabs", "pinned", "passwords", "extensions", "settings"],
  );
  assert.deepEqual(Object.keys(defaultTypes()), DATA_TYPES.map((t) => t.id));
  assert.ok(Object.values(defaultTypes()).every((on) => on));
});

test("a profile that shares another's data syncs only the types that aren't its data", () => {
  const types = defaultTypes();
  const shared = DATA_TYPES.filter((t) => typeSyncedFor(types, t.id, false)).map((t) => t.id);
  assert.deepEqual(shared, ["tabs", "pinned", "settings"]);
  assert.equal(typeSyncedFor({ ...types, bookmarks: false }, "bookmarks", true), false);
  assert.equal(typeSyncedFor(types, "extensions", true), true);
});
