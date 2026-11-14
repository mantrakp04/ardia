#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { transpile } from "./transpile-sync-bundle.mjs";

const [checksFile, outDirectory, appDirectory] = process.argv.slice(2);
if (!checksFile || !outDirectory || !appDirectory) {
  console.error("usage: make-sync-checks.mjs <sync-runtime-checks.js> <out dir> <apps/phone>");
  process.exit(2);
}

const resultsOf = async (source) => {
  const context = vm.createContext({ __host: { labEcho: (text) => `echo:${text}` } });
  vm.runInContext(source, context, { filename: "sync-runtime-checks.js" });
  return JSON.stringify(await vm.runInContext("ArdiaSyncChecks.run()", context));
};

const source = readFileSync(checksFile, "utf8");
const transpiled = transpile(source, appDirectory);
const expected = await resultsOf(source);
const fromTranspiled = await resultsOf(transpiled);
if (fromTranspiled !== expected) {
  console.error(`the transpiled runtime checks give other results than the source in Node:\nsource     ${expected}\ntranspiled ${fromTranspiled}`);
  process.exit(1);
}
mkdirSync(outDirectory, { recursive: true });
writeFileSync(resolve(outDirectory, "ardia-sync-checks.js"), transpiled);
writeFileSync(resolve(outDirectory, "ardia-sync-checks.json"), expected);
