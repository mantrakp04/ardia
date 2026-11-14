import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSession } from "./persist.ts";

for (const version of [9, 10, 11, 12]) {
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

for (const version of [10, 11]) {
  test(`version ${version} runs closed-group migration without repeating the unread-count migration`, () => {
    const closedGroups = [undefined, false, true].map((hiddenFromBar, i) => ({
      id: String(i), group: { id: String(i), name: "Saved" }, hiddenFromBar,
      tabs: [{ url: "https://example.com/", profileId: "default" }],
    }));
    const session = parseSession(JSON.stringify({
      version, closedGroups, settings: { showUnreadCounts: true }, settingsMeta: { chosen: [], inferred: [] },
    }));
    assert.deepEqual(session.closedGroups.map((group) => group.hiddenFromBar), [false, false, true]);
    assert.equal(session.settings.showUnreadCounts, version === 10 ? undefined : true);
  });
}
