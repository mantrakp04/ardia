import assert from "node:assert/strict";
import { test } from "node:test";
const { diaSpacesFor } = await import("./diaTabs.ts");

const dia = (spaces) => ({ profiles: spaces.map(([name, index]) => ({ id: `${index}:${name}`, name, index, pinned: [], tabs: [] })), windowCount: 1, skipped: 0, duplicates: 0, favicons: [] });
const onDisk = [
  { id: "Default", name: "Personal" },
  { id: "Space 2", name: "Work" },
];
const ids = (map) => Object.fromEntries([...map].map(([k, v]) => [k, v.id]));

test("Dia's tabs go to the space on disk with the same name, whatever the order", () => {
  assert.deepEqual(ids(diaSpacesFor(dia([["Work", 1], [" personal ", 2]]), onDisk)), { Default: "2: personal ", "Space 2": "1:Work" });
});

test("without a name match a Dia space goes by position, never onto a space another one is named after", () => {
  assert.deepEqual(ids(diaSpacesFor(dia([["Space 1", 1], ["Work", 2]]), onDisk)), { Default: "1:Space 1", "Space 2": "2:Work" });
  assert.deepEqual(ids(diaSpacesFor(dia([["Work", 1]]), onDisk)), { "Space 2": "1:Work" });
});

test("spaces sharing a name each get their own Dia space, by position", () => {
  const twins = [
    { id: "Default", name: "Personal" },
    { id: "Space 2", name: "personal" },
  ];
  assert.deepEqual(ids(diaSpacesFor(dia([["Personal", 1], ["Personal", 2]]), twins)), { Default: "1:Personal", "Space 2": "2:Personal" });
});
