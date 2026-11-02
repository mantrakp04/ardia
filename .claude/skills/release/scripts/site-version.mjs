#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [version] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: site-version.mjs <stable version>: points the site and README downloads at that published release");
  process.exit(64);
}
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const repo = "mantrakp04/ardia";
const dmgName = `Ardia-${version}.dmg`;
const assets = JSON.parse(execFileSync("gh", ["release", "view", `v${version}`, "-R", repo, "--json", "assets"], { encoding: "utf8" })).assets;
const dmg = assets.find((asset) => asset.name === dmgName);
if (!dmg) {
  console.error(`v${version} has no ${dmgName}: publish it first`);
  process.exit(1);
}

writeFileSync(`${root}/apps/site/src/data/release.json`, `${JSON.stringify({ version, dmgBytes: dmg.size })}\n`);

const megabytes = Math.round(dmg.size / 1e6);
const readmePath = `${root}/README.md`;
const readme = readFileSync(readmePath, "utf8");
const updated = readme
  .replace(/releases\/(?:latest\/download|download\/v[\d.]+)\/Ardia-[\d.]+\.dmg/g, `releases/download/v${version}/${dmgName}`)
  .replace(/Download Ardia [\d.]+/g, `Download Ardia ${version}`)
  .replace(/\d+ MB DMG/g, `${megabytes} MB DMG`)
  .replace(/It’s \d+ MB/g, `It’s ${megabytes} MB`);
writeFileSync(readmePath, updated);
console.log(`site and README: Ardia ${version}, ${megabytes} MB (${dmg.size} bytes)`);
