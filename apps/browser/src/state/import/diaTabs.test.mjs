import assert from "node:assert/strict";
import { test } from "node:test";
const { diaProfilesFor } = await import("./diaTabs.ts");

const dia = (profiles) => ({ profiles: profiles.map(([name, index]) => ({ id: `${index}:${name}`, name, index, pinned: [], tabs: [] })), windowCount: 1, skipped: 0, duplicates: 0, favicons: [] });
const onDisk = [
  { id: "Default", name: "Personal" },
  { id: "Profile 2", name: "Work" },
];
const ids = (map) => Object.fromEntries([...map].map(([k, v]) => [k, v.id]));

test("Dia's tabs go to the profile on disk with the same name, whatever the order", () => {
  assert.deepEqual(ids(diaProfilesFor(dia([["Work", 1], [" personal ", 2]]), onDisk)), { Default: "2: personal ", "Profile 2": "1:Work" });
});

test("without a name match a Dia profile goes by position, never onto a profile another one is named after", () => {
  assert.deepEqual(ids(diaProfilesFor(dia([["Profile 1", 1], ["Work", 2]]), onDisk)), { Default: "1:Profile 1", "Profile 2": "2:Work" });
  assert.deepEqual(ids(diaProfilesFor(dia([["Work", 1]]), onDisk)), { "Profile 2": "1:Work" });
});

test("profiles sharing a name each get their own Dia profile, by position", () => {
  const twins = [
    { id: "Default", name: "Personal" },
    { id: "Profile 2", name: "personal" },
  ];
  assert.deepEqual(ids(diaProfilesFor(dia([["Personal", 1], ["Personal", 2]]), twins)), { Default: "1:Personal", "Profile 2": "2:Personal" });
});
