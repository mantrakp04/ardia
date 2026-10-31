import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSession } from "./persist.ts";

for (const version of [9, 10]) {
  test(`version ${version} closed and deleted groups reject broken metadata and keep legacy nullable fields`, () => {
    const valid = [
      { id: "g", name: "", icon: null, color: null, pinned: false },
      { id: "legacy", name: "Legacy" },
      { id: "named", name: "Research", icon: "book", color: "blue", pinned: true, parentId: "root" },
    ];
    const invalid = [
      undefined, null, "group", 3, [], {}, { id: "g", name: 3 }, { id: 3, name: "G" },
      { id: "g", name: "G", icon: {} }, { id: "g", name: "G", color: [] },
      { id: "g", name: "G", pinned: "false" }, { id: "g", name: "G", parentId: {} },
    ];
    const entries = [...valid, ...invalid].map((group, index) => ({
      id: String(index), group, tabs: [{ url: "https://example.com/", profileId: "default" }],
    }));
    const session = parseSession(JSON.stringify({ version, closedGroups: entries, deletedGroups: entries }));
    for (const key of ["closedGroups", "deletedGroups"]) {
      assert.deepEqual(session[key].map((entry) => entry.group), valid);
    }
  });
}
