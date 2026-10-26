#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const repo = resolve(appDir, "../..");
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) (args[i].startsWith("--") ? (flags[args[i].slice(2)] = args[++i]) : positional.push(args[i]));
const [beforeRev = "f3417151^", afterRev = "f3417151"] = positional;
const out = resolve(flags.out ?? join(process.env.TMPDIR ?? "/tmp", "ac-ratchet-proof"));

const micro = readFileSync(join(here, "micro-bench.mjs"), "utf8");
const bigSession = /\/\/ One window with `count` tabs.*?\n}\n/s.exec(micro)[0];
const workload = `
const { useBrowser } = await import("../../src/state/browser/store.ts");
const { sidebarEntries } = await import("../../src/state/sidebar/entries.ts");
await import("../../src/test-native/index.ts");
const { countOps } = await import("./ops.mjs");
const S = () => useBrowser.getState();
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
${bigSession}
for (const count of [200, 1000]) {
  const ids = bigSession(count);
  sidebarEntries(S(), "w");
  const times = [];
  for (let r = 0; r < 60; r++) {
    S().updateTab(ids[(r * 7) % count], { title: "T" + r });
    const t = performance.now();
    sidebarEntries(S(), "w");
    times.push(performance.now() - t);
  }
  S().updateTab(ids[3], { title: "count me" });
  const { total } = countOps(() => sidebarEntries(S(), "w"));
  console.log(JSON.stringify({ count, calls: total, ms: median(times.slice(10)) }));
}
`;

const results = {};
for (const [name, rev] of [["before", beforeRev], ["after", afterRev]]) {
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["-C", repo, "archive", rev, "apps/browser/src", "apps/browser/package.json", "packages/core"], { maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  symlinkSync(join(appDir, "node_modules"), join(dir, "apps/browser/node_modules"));
  copyFileSync(join(appDir, "src/test-loader.mjs"), join(dir, "apps/browser/src/test-loader.mjs"));
  cpSync(join(appDir, "src/test-native"), join(dir, "apps/browser/src/test-native"), { recursive: true });
  const perf = join(dir, "apps/browser/scripts/perf");
  mkdirSync(perf, { recursive: true });
  copyFileSync(join(here, "ops.mjs"), join(perf, "ops.mjs"));
  writeFileSync(join(perf, "proof.mjs"), workload);
  const lines = execFileSync(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", "scripts/perf/proof.mjs"], { cwd: join(dir, "apps/browser"), encoding: "utf8" });
  results[name] = lines.trim().split("\n").map((l) => JSON.parse(l));
}

console.log(`sidebarEntries after a title change, ${beforeRev} -> ${afterRev}`);
for (const [i, b] of results.before.entries()) {
  const a = results.after[i];
  console.log(`${String(b.count).padStart(5)} tabs: ${b.calls} -> ${a.calls} builtin calls (${((a.calls / b.calls - 1) * 100).toFixed(0)}%), ${b.ms.toFixed(3)} -> ${a.ms.toFixed(3)} ms (${((a.ms / b.ms - 1) * 100).toFixed(0)}%)`);
}
rmSync(out, { recursive: true, force: true });
