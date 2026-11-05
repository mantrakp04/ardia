import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { collectAppSymbols } from "./collect.mjs";
import { fitSymbols } from "./fit.mjs";
import { writeData } from "./gen-data.mjs";
import { computeNudges } from "./nudge.mjs";
import { SCRATCH } from "./paths.mjs";
import { hasVocabulary, symbolVocabulary } from "./vocabulary.mjs";

const USAGE = `Regenerates packages/demo/src/shims/web/symbols/data.ts and THIRD_PARTY_NOTICES.txt from every SF Symbol name apps/browser/src uses.

  node packages/demo/scripts/icons/regenerate.mjs [--only a,b] [--sheet] [--pt 13] [--weight regular]

  --only    refit only these symbols, reusing the other fits cached in ${SCRATCH} (a full run when the cache is missing)
  --sheet   also write a contact sheet (native vs web, worst first) to ${SCRATCH}
  --pt, --weight   the contact sheet's point size and weight

A new symbol needs candidates first: open-icon ids in curated.mjs, or layered recipes and original geometry in recipes.mjs and originals.mjs.
Native renders, the fit cache and the sheet go to ${SCRATCH} (ARDIA_ICONS_SCRATCH overrides it), never into the repo. Needs macOS with swiftc.`;

const { values } = parseArgs({ options: { only: { type: "string" }, sheet: { type: "boolean" }, pt: { type: "string", default: "13" }, weight: { type: "string", default: "regular" }, help: { type: "boolean", short: "h" } } });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!hasVocabulary()) {
  console.error("regenerate needs macOS: it renders native SF Symbols for comparison");
  process.exit(1);
}

mkdirSync(SCRATCH, { recursive: true });
const FITS = `${SCRATCH}/fits.json`, NUDGES = `${SCRATCH}/nudges.json`;
const names = [...collectAppSymbols(symbolVocabulary()).keys()].sort();
const cached = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
let fits = cached(FITS), nudges = cached(NUDGES);
const requested = values.only ? values.only.split(",").map((n) => n.trim()).filter(Boolean) : null;
const stale = names.filter((name) => !fits[name] || !nudges[name]);
const toFit = requested ? [...new Set([...requested, ...stale])] : names;
if (!requested) { fits = {}; nudges = {}; }

console.log(`${names.length} app symbols; fitting ${toFit.length}`);
const started = Date.now();
Object.assign(fits, await fitSymbols(toFit));
writeFileSync(FITS, JSON.stringify(fits));
console.log(`  fitted in ${((Date.now() - started) / 1000).toFixed(0)}s; measuring native placement`);
Object.assign(nudges, computeNudges(fits, toFit));
writeFileSync(NUDGES, JSON.stringify(nudges));

const shipped = Object.fromEntries(names.map((name) => [name, fits[name]]));
const { bodies, bytes } = writeData(shipped, nudges);
console.log(`wrote data.ts: ${names.length} symbols, ${bodies} bodies, ${(bytes / 1024).toFixed(0)} KB`);
const worst = names.map((name) => [name, shipped[name].perWeight.regular.exact]).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`worst at 26pt regular: ${worst.map(([n, s]) => `${n} ${s.toFixed(2)}`).join(", ")}`);
for (const name of toFit.filter((n) => names.includes(n))) {
  if (requested || toFit.length < 20) console.log(`  ${name}: ${shipped[name].layers.map((l) => l.src).join(" + ")} (${shipped[name].perWeight.regular.exact.toFixed(3)})`);
}

if (values.sheet) {
  const { contactSheet } = await import("./contact.mjs");
  const sheet = await contactSheet(shipped, nudges, { pt: Number(values.pt), weight: values.weight });
  console.log(`contact sheet: ${sheet.out}\n  worst: ${sheet.worst.join(", ")}`);
}
