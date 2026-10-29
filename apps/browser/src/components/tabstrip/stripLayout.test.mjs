import assert from "node:assert/strict";
import { test } from "node:test";
const { layoutDock, layoutStrip } = await import("./stripGroups.ts");

const tab = (id, group = null) => ({ kind: "tab", id, group });
const folder = (id, tabIds, group) => ({ kind: "folder", id, tabIds, group });
const group = (id, members, collapsed = false) => ({ kind: "group", id, collapsed, members });
const dock = (ids, members = {}) => ({ kind: "dock", ids, members: new Map(Object.entries(members)) });
const measured = (groups = {}, folders = {}) => ({ groupChip: (id) => groups[id], folderChip: (id) => folders[id] });
const dockOf = (entries) => layoutDock(entries.find((e) => e.kind === "dock"));
const layout = (entries, activeId, m = measured()) => layoutStrip(entries, activeId, 1000, m, dockOf(entries));

test("tabs share the page after the new-tab button, rounded to half points and kept between the min and max chip", () => {
  const six = ["a", "b", "c", "d", "e", "f"].map((id) => tab(id));
  assert.equal(layout(six, "a").chip, 156.5);
  assert.equal(layout(six.slice(0, 3), "a").chip, 173);
  assert.equal(layout([...six, ...six.map((t) => tab(`${t.id}2`))], "a").chip, 96);
});

test("the pinned dock takes its cells and its gap off the room and off every top slot's left", () => {
  const entries = [dock(["folder:f", "p1", "a"], { "folder:f": ["a", "b"] }), ...["x", "y", "z", "u", "v", "w"].map((id) => tab(id))];
  const strip = layout(entries, "x");
  assert.equal(strip.chip, 138.5);
  assert.deepEqual(strip.spanOf("x"), [110.5, 138.5]);
  assert.deepEqual(strip.spanOf("y"), [110.5 + 138.5 + 4, 138.5]);
  assert.equal(dockOf(entries).left, -110.5);
  assert.deepEqual(dockOf(entries).geometry.slots.map((s) => s.tabIds), [["a", "b"], ["p1"], ["a"]]);
});

test("a selected pinned tab reveals its own dock cell, and a tab only in a tile folder reveals the folder", () => {
  const entries = [dock(["folder:f", "p1", "a"], { "folder:f": ["a", "b"] }), tab("x")];
  const strip = layout(entries, "a");
  assert.deepEqual(strip.spanOf("a"), [72, 34]);
  assert.deepEqual(strip.spanOf("b"), [0, 34]);
  assert.deepEqual(strip.spanOf("p1"), [36, 34]);
  assert.equal(strip.spanOf("gone"), null);
});

test("an open group lays out its chip, its members and a nested folder holding the selected tab after the folder chip", () => {
  const entries = [tab("t1"), group("G", [tab("a", "G"), folder("F", ["b", "c"], "G"), tab("d", "G")]), tab("t2")];
  const strip = layout(entries, "c", measured({ G: 60 }, { F: 50 }));
  assert.equal(strip.chip, 156);
  assert.equal(strip.memberWidth(entries[1].members[1]), 212.5);
  assert.deepEqual(strip.top.lefts, [0, 163.5, 800.75]);
  assert.deepEqual(strip.top.slots.map((s) => s.width), [156, 629.25, 156]);
  assert.deepEqual(strip.top.slots[1].tabIds, ["a", "b", "c", "d"]);
  assert.deepEqual(strip.spanOf("c"), [390, 212.5]);
  assert.deepEqual(strip.spanOf("d"), [606.5, 156]);
  assert.deepEqual(strip.spanOf("t2"), [800.75, 156]);
  assert.deepEqual(strip.targets, [{ kind: "tab", id: "t1" }, { kind: "group", id: "G" }, { kind: "tab", id: "t2" }]);
});

test("a closed group shows only the member holding the selected tab, right after its chip", () => {
  const entries = [tab("t1"), group("G", [tab("a", "G"), folder("F", ["b", "c"], "G"), tab("d", "G")], true), tab("t2")];
  const strip = layout(entries, "c", measured({ G: 60 }, { F: 50 }));
  assert.equal(strip.chip, 173);
  assert.deepEqual(strip.top.slots.map((s) => s.width), [173, 300.5, 173]);
  assert.deepEqual(strip.spanOf("c"), [247, 229.5]);
});

test("a folder without the selected tab is only its chip, and a split takes two chips", () => {
  const entries = [group("G", [folder("F", ["b"], "G"), tab("a", "G")]), { kind: "split", id: "s", tabIds: ["x", "y"], group: null }];
  const strip = layout(entries, "a", measured({ G: 60 }, { F: 50 }));
  assert.equal(strip.memberWidth(entries[0].members[0]), 50);
  assert.equal(strip.top.slots[1].width, strip.chip * 2);
  assert.deepEqual(strip.targets, [{ kind: "group", id: "G" }, null]);
});

test("an unmeasured group or folder chip counts as zero wide until it is measured", () => {
  const entries = [group("G", [folder("F", ["b", "c"], "G")])];
  const strip = layout(entries, "c");
  assert.deepEqual(strip.spanOf("c"), [3.5 + 6.5, 6.5 + strip.chip]);
});
