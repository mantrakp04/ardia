import assert from "node:assert/strict";
import { test } from "node:test";
import { appVersionOf, launchProps, legacyImportOutcome, osVersionOf, parseDaily, rollOver } from "./telemetrySchema.ts";

test("launch timings are measured from the process start, and dropped when it is unknown or out of range", () => {
  assert.deepEqual(launchProps(1000, 1300, 1900), { launch_ms: 900, js_ms: 300 });
  assert.equal(launchProps(null, 1300, 1900), null);
  assert.equal(launchProps(2000, 1300, 1900), null);
  assert.equal(launchProps(0, 1, 700_001), null);
});

test("the old app's import reads as imported, skipped or none from the importer's marker", () => {
  assert.equal(legacyImportOutcome("1", "1", "skipped-existing"), "imported");
  assert.equal(legacyImportOutcome("skipped-existing", "1", "skipped-existing"), "skipped");
  assert.equal(legacyImportOutcome(null, "1", "skipped-existing"), "none");
});

test("versions keep only their numbers", () => {
  assert.equal(osVersionOf(35), "35");
  assert.equal(osVersionOf("18.1.1"), "18.1.1");
  assert.equal(osVersionOf("15 (Ada's build)"), "15");
  assert.equal(appVersionOf("1.0.0"), "1.0.0");
  assert.equal(appVersionOf("Ardia nightly"), "0");
});

test("a damaged day of counts starts over rather than sending something odd", () => {
  assert.equal(parseDaily("{"), null);
  assert.equal(parseDaily(JSON.stringify({ day: "yesterday", tabs_opened: 3 })), null);
  assert.deepEqual(parseDaily(JSON.stringify({ day: "2026-11-13", tabs_opened: -2, searches: 1.5, pins_to_mac: 2 })), { day: "2026-11-13", tabs_opened: 0, searches: 0, pins_to_mac: 2, tabs_sent: 0, page_processes_gone: 0 });
  assert.deepEqual(rollOver(null, "2026-11-14").due, null);
});
