import { readFileSync } from "node:fs";
import vm from "node:vm";

const BUNDLE_URL = "ardia-sync-bundle:companion";
let bundlePath = null;

export function initialize(data) {
  bundlePath = data.bundle;
}

export async function resolve(specifier, context, next) {
  const parent = context.parentURL ?? "";
  const fromSyncSources = parent.includes("/packages/sync/src/");
  const local = (specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".ts");
  if (fromSyncSources && local && !parent.startsWith(BUNDLE_URL)) return { url: BUNDLE_URL, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url !== BUNDLE_URL) return next(url, context);
  const source = readFileSync(bundlePath, "utf8");
  const probe = vm.createContext({});
  vm.runInContext(source, probe);
  const names = Object.keys(probe.ArdiaSync);
  const lines = [`(0, eval)(${JSON.stringify(source)});`, "const bundle = globalThis.ArdiaSync;"];
  for (const name of names) lines.push(`export const ${name} = bundle[${JSON.stringify(name)}];`);
  return { format: "module", source: lines.join("\n"), shortCircuit: true };
}
