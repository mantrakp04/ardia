import { test } from "node:test";
import assert from "node:assert/strict";
import { healthVersionRows } from "./health-rows.ts";

test("a crash credited to a version with no usage in the window still gets a row, with no rate", () => {
  const usage = [
    { version: "0.2.45-nightly.3", users: 40, launches: 50, unclean: 2, uncleanPeople: 2 },
    { version: "", users: 40, launches: 50, unclean: 2, uncleanPeople: 2 },
  ];
  const crashes = new Map([
    ["0.2.45-nightly.3", 1],
    ["0.2.45-nightly.2", 3],
  ]);
  const js = new Map([["0.2.44", 2]]);
  const rows = healthVersionRows(usage, crashes, js);
  assert.deepEqual(
    rows.map((r) => [r.version, r.users, r.crashes, r.jsErrors, r.crashesPer100, r.uncleanRate]),
    [
      ["0.2.45-nightly.3", 40, 1, 0, 2.5, 0.04],
      ["0.2.45-nightly.2", 0, 3, 0, null, null],
      ["0.2.44", 0, 0, 2, null, null],
    ],
  );
  assert.equal(rows[1]?.nightly, true);
});
