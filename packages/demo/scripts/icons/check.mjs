import { collectAppSymbols } from "./collect.mjs";
import { hasVocabulary, symbolVocabulary } from "./vocabulary.mjs";
import { SYMBOL_NAMES } from "../../src/shims/web/symbols/data.ts";

if (!hasVocabulary()) {
  console.log("icons check skipped: needs macOS (CoreGlyphs symbol names)");
  process.exit(0);
}
const used = collectAppSymbols(symbolVocabulary());
const shipped = new Set(SYMBOL_NAMES);
const missing = [...used.keys()].filter((name) => !shipped.has(name)).sort();
if (missing.length) {
  console.error(`icons check: ${missing.length} symbol(s) the app draws have no web icon in packages/demo/src/shims/web/symbols/data.ts:`);
  for (const name of missing) console.error(`  ${name}  (${used.get(name).slice(0, 2).join(", ")})`);
  console.error("Add candidates in packages/demo/scripts/icons/curated.mjs or recipes.mjs, then run: node packages/demo/scripts/icons/regenerate.mjs");
  process.exit(1);
}
console.log(`icons check: all ${used.size} app symbols have web icons`);
