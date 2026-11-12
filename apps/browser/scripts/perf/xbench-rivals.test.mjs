import assert from "node:assert/strict";
import test from "node:test";
import { mergeRivals, rivalWarnings, RivalsRefused } from "./xbench-rivals.mjs";

const MACHINE = { model: "MacBook Pro (Mac17,9)", chip: "Apple M5 Pro", cores: 15, ram: "48 GB", macOS: "27.2 (26B5112a)" };
const entry = (name, version, median, extra = {}) => ({ name, version, chromium: "155", median, min: median, max: median, n: 3, ...extra });

const stored = () => ({
  date: "2026-10-19",
  machine: MACHINE,
  harness: 1,
  browsers: {
    ardia: { name: "Ardia", version: "0.2.38-nightly.8", chromium: "155", measured: "2026-10-19" },
    dia: { name: "Dia", version: "1.53.0", chromium: "155", measured: "2026-10-16" },
    helium: { name: "Helium", version: "0.19.3.1", chromium: "155" },
  },
  rows: [
    { id: "newtab", label: "New tab → first paint", unit: "ms", lowerIsBetter: true, best: "ardia",
      browsers: { ardia: entry("Ardia", "0.2.38-nightly.8", 55), dia: entry("Dia", "1.53.0", 89), helium: entry("Helium", "0.19.3.1", 71) } },
    { id: "launch-restore", label: "Cold launch → restored tab painted", unit: "ms", lowerIsBetter: true, best: "helium",
      browsers: { ardia: entry("Ardia", "0.2.38-nightly.8", 360), dia: entry("Dia", "1.53.0", null, { n: 0, note: "start view" }), helium: entry("Helium", "0.19.3.1", 355) } },
    { id: "speedometer", label: "Speedometer 3", unit: "score", lowerIsBetter: false, best: "ardia",
      browsers: { ardia: entry("Ardia", "0.2.38-nightly.7", 59.1, { measured: "2026-10-18" }), helium: entry("Helium", "0.19.3.1", 58.5), dia: entry("Dia", "1.53.0", 58.2) } },
  ],
  method: "docs/perf/vs-browsers.md",
  notes: ["stored note"],
});

const fresh = (over = {}) => ({
  date: "2026-11-09",
  machine: { ...MACHINE, macOS: "27.3 (26C10)" },
  harness: 1,
  browsers: { ardia: { name: "Ardia", version: "0.2.46", chromium: "155" } },
  rows: [
    { id: "newtab", label: "New tab → first paint", unit: "ms", lowerIsBetter: true, best: "ardia", browsers: { ardia: entry("Ardia", "0.2.46", 80) } },
    { id: "launch-restore", label: "Cold launch → restored tab painted", unit: "ms", lowerIsBetter: true, best: "ardia", browsers: { ardia: entry("Ardia", "0.2.46", 340) } },
    { id: "memory-1", label: "Memory, 1 tab", unit: "MB", lowerIsBetter: true, best: "ardia", browsers: { ardia: entry("Ardia", "0.2.46", 290) } },
  ],
  method: "docs/perf/vs-browsers.md",
  notes: ["fresh note"],
  ...over,
});

test("rivals keep their figures, version and own measured date; Ardia is replaced and dated today", () => {
  const m = mergeRivals(fresh(), stored());
  assert.equal(m.date, "2026-11-09");
  assert.deepEqual(Object.fromEntries(Object.entries(m.browsers).map(([k, b]) => [k, [b.version, b.measured]])), {
    ardia: ["0.2.46", "2026-11-09"],
    dia: ["1.53.0", "2026-10-16"],
    helium: ["0.19.3.1", "2026-10-19"],
  });
  const newtab = m.rows.find((r) => r.id === "newtab");
  assert.deepEqual(newtab.browsers.ardia, { ...entry("Ardia", "0.2.46", 80), measured: "2026-11-09" });
  assert.deepEqual(newtab.browsers.dia, { ...entry("Dia", "1.53.0", 89), measured: "2026-10-16" });
  assert.deepEqual(newtab.browsers.helium, { ...entry("Helium", "0.19.3.1", 71), measured: "2026-10-19" });
  assert.equal(newtab.best, "helium");
  assert.equal(m.machine.macOS, "27.3 (26C10)");
  assert.deepEqual(m.notes, ["stored note"]);
  assert.equal(m.forced, undefined);
});

test("a rival's note and null median survive; best is taken again over the merged row", () => {
  const restore = mergeRivals(fresh(), stored()).rows.find((r) => r.id === "launch-restore");
  assert.equal(restore.browsers.dia.median, null);
  assert.equal(restore.browsers.dia.note, "start view");
  assert.equal(restore.best, "ardia");
});

test("a row the Ardia run didn't measure keeps every entry, Ardia's included, at its own date", () => {
  const speedometer = mergeRivals(fresh(), stored()).rows.find((r) => r.id === "speedometer");
  assert.equal(speedometer.browsers.ardia.version, "0.2.38-nightly.7");
  assert.equal(speedometer.browsers.ardia.measured, "2026-10-18");
  assert.equal(speedometer.browsers.dia.measured, "2026-10-16");
  assert.equal(speedometer.browsers.helium.measured, "2026-10-19");
});

test("a row only the new run has is added with Ardia alone; stored row order is kept", () => {
  const m = mergeRivals(fresh(), stored());
  assert.deepEqual(m.rows.map((r) => r.id), ["newtab", "launch-restore", "speedometer", "memory-1"]);
  assert.deepEqual(Object.keys(m.rows.at(-1).browsers), ["ardia"]);
});

test("another Mac model or chip is refused unless forced, and a forced merge says why", () => {
  for (const machine of [{ ...MACHINE, chip: "Apple M6" }, { ...MACHINE, model: "MacBook Air (Mac16,12)" }])
    assert.throws(() => mergeRivals(fresh({ machine }), stored()), RivalsRefused);
  const forced = mergeRivals(fresh({ machine: { ...MACHINE, chip: "Apple M6" } }), stored(), { force: true });
  assert.match(forced.forced.join(), /chip: stored "Apple M5 Pro", this Mac "Apple M6"/);
});

test("a machine stored as plain text can't be compared, so it's refused", () => {
  assert.throws(() => mergeRivals(fresh(), { ...stored(), machine: "MacBook Pro, M5 Pro" }), RivalsRefused);
});

test("another harness revision, or none recorded, is refused", () => {
  assert.throws(() => mergeRivals(fresh({ harness: 2 }), stored()), /different harness \(stored 1, this one 2\)/);
  const { harness: _, ...unrecorded } = stored();
  assert.throws(() => mergeRivals(fresh(), unrecorded), /stored unrecorded/);
});

test("rivals over 60 days old or with a new major or minor version flag a full rerun", () => {
  const merged = mergeRivals(fresh({ date: "2026-12-20" }), stored());
  const warnings = rivalWarnings(merged, { installed: { dia: "1.54.0", helium: "0.19.4.2" } });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /^Dia was measured 65 days ago/);
  assert.match(warnings[1], /^Dia is now 1\.54\.0, measured on 1\.53\.0: a new minor version/);
  assert.match(warnings[2], /^Helium was measured 62 days ago/);
  assert.deepEqual(rivalWarnings(mergeRivals(fresh(), stored()), { installed: { helium: "0.19.4.2" } }), []);
  assert.match(rivalWarnings(mergeRivals(fresh(), stored()), { installed: { helium: "1.0.0" } })[0], /a new major version/);
});
