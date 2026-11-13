#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

await import("../src/test-loader.mjs");
const { backdropFixture } = await import("../src/state/sync/fixtures/themeBackdrops.ts");

export const FIXTURE_FILE = fileURLToPath(new URL("../src/state/sync/fixtures/theme-backdrops.json", import.meta.url));
export const RELATIVE_TOLERANCE = 1e-9;

const near = (actual, expected) => Math.abs(actual - expected) <= RELATIVE_TOLERANCE * Math.max(1, Math.abs(actual), Math.abs(expected));
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function fixtureDifference(actual, expected, path = "") {
  if (typeof actual === "number" && typeof expected === "number") return near(actual, expected) ? null : `${path}: ${actual} is not ${expected}`;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${path}: ${actual.length} items, not ${expected.length}`;
    for (let i = 0; i < actual.length; i++) {
      const found = fixtureDifference(actual[i], expected[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isRecord(actual) && isRecord(expected)) {
    for (const key of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (!(key in actual) || !(key in expected)) return `${path}.${key}: ${key in actual ? "not in the fixture" : "missing"}`;
      const found = fixtureDifference(actual[key], expected[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return Object.is(actual, expected) ? null : `${path}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`;
}

export function checkFixture(text = readFileSync(FIXTURE_FILE, "utf8")) {
  const actual = backdropFixture().cases;
  const expected = JSON.parse(text).cases;
  if (!Array.isArray(expected)) return "the fixture has no cases";
  if (actual.length !== expected.length) return `${actual.length} cases, not ${expected.length}`;
  for (let i = 0; i < actual.length; i++) {
    const found = fixtureDifference(actual[i], expected[i]);
    if (found) return `${expected[i]?.name ?? `case ${i}`}: ${found}`;
  }
  return null;
}

const isFlat = (v) => (Array.isArray(v) ? v : Object.values(v)).every((item) => item === null || typeof item !== "object");

export function formatFixture(value, indent = "") {
  if (value === null || typeof value !== "object" || isFlat(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((item) => inner + formatFixture(item, inner)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatFixture(item, inner)}`).join(",\n")}\n${indent}}`;
}

export const renderFixture = () => `${formatFixture(backdropFixture())}\n`;

const HELP = `Writes or checks apps/browser/src/state/sync/fixtures/theme-backdrops.json: the backdrop the Mac's own look
functions (lib/profileLook.ts) give for each synced theme in fixtures/themeBackdrops.ts. themeBackdrops.test.mjs and
the iPhone's ProfileLookTests read it, comparing numbers within 1e-9 relative. After an intended change to the look
maths, run --write, then make the iPhone's ProfileTheme.swift match.

  node --no-warnings apps/browser/scripts/theme-backdrops.mjs --check
  node --no-warnings apps/browser/scripts/theme-backdrops.mjs --write`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--write")) {
    writeFileSync(FIXTURE_FILE, renderFixture());
  } else if (process.argv.includes("--check")) {
    const found = checkFixture();
    if (found) {
      console.error(`theme-backdrops.json is out of date: ${found}\nRun node --no-warnings apps/browser/scripts/theme-backdrops.mjs --write`);
      process.exit(1);
    }
  } else {
    console.log(HELP);
    process.exit(process.argv.includes("--help") || process.argv.includes("-h") ? 0 : 2);
  }
}
