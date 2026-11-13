#!/usr/bin/env node
// Usage: node --no-warnings --import ./apps/browser/src/test-loader.mjs apps/ios/scripts/glass-tint-fixture.mjs [--check] [--help]
// Writes ArdiaKit/Fixtures/glass-tints.json from the Mac's own controlGlassTint and panelGlassTint
// (apps/browser/src/components/ui/Glass.tsx), which GlassTintFixtureTests hold the iPhone's glass maths to.
// Run it from the repo root after installing the browser's packages. --check exits 1 when the fixture is out of date.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const fixture = new URL("../Packages/ArdiaKit/Fixtures/glass-tints.json", import.meta.url);
const PRESETS = ["plum", "blue", "yellow", "neutral"];
const STATES = ["rest", "lit", "pressed", "active"];
const CONTROL_AMOUNTS = [0, 0.15, 0.8, 1];
const PANEL_AMOUNTS = [0, 0.8];

async function macTints() {
  globalThis.__DEV__ ??= false;
  const { controlGlassTint, panelGlassTint } = await import(new URL("../../browser/src/components/ui/Glass.tsx", import.meta.url).href);
  const { themeFor } = await import(new URL("../../browser/src/components/ui/theme.ts", import.meta.url).href);
  const schemes = PRESETS.flatMap((preset) => [true, false].map((dark) => ({ preset, dark, theme: themeFor(`${preset}:${dark ? "dark" : "light"}`) })));
  return {
    controls: schemes.flatMap(({ preset, dark, theme }) =>
      STATES.flatMap((state) => CONTROL_AMOUNTS.map((amount) => ({ preset, dark, state, amount, tint: controlGlassTint(theme, state, amount) }))),
    ),
    panels: schemes.flatMap(({ preset, dark, theme }) =>
      PANEL_AMOUNTS.map((amount) => ({ preset, dark, amount, tint: panelGlassTint(theme, theme.panel, amount) })),
    ),
  };
}

if (process.argv.includes("--help")) {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((line) => line.startsWith("// "));
  console.log(header.map((line) => line.slice(3)).join("\n"));
  process.exit(0);
}

const text = `${JSON.stringify(await macTints(), null, 1)}\n`;
if (process.argv.includes("--check")) {
  if (existsSync(fixture) && readFileSync(fixture, "utf8") === text) process.exit(0);
  console.error("ArdiaKit/Fixtures/glass-tints.json is out of date: run apps/ios/scripts/glass-tint-fixture.mjs");
  process.exit(1);
}
writeFileSync(fixture, text);
console.log(`${fileURLToPath(fixture)} (${text.length} bytes)`);
