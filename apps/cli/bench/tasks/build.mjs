#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const usage = `Usage: node tasks/build.mjs <task> [<task> ...]

Bundles and minifies each entry listed in tasks/<task>/src/bundles.json ({"out": "src"} pairs, paths relative to the
task folder) with esbuild, so the served app is one minified file like a production build.`;

const ESBUILD = "esbuild@0.28.2";
const here = dirname(fileURLToPath(import.meta.url));
const tasks = process.argv.slice(2);
if (!tasks.length || tasks.includes("-h") || tasks.includes("--help")) {
  console.log(usage);
  process.exit(tasks.length ? 0 : 64);
}
for (const task of tasks) {
  const dir = resolve(here, task);
  const manifest = join(dir, "src/bundles.json");
  if (!existsSync(manifest)) throw new Error(`${manifest} is missing`);
  for (const [out, src] of Object.entries(JSON.parse(readFileSync(manifest, "utf8")))) {
    execFileSync("npx", ["--yes", ESBUILD, join(dir, src), "--bundle", "--minify", "--format=iife", "--target=es2022",
      "--legal-comments=none", `--outfile=${join(dir, out)}`, "--log-level=warning"], { stdio: "inherit" });
    console.log(`${task}: ${out}`);
  }
}
