import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./paths.mjs";

const ROOTS = ["apps/browser/src"];
const LITERAL = /(["'`])([a-z0-9]+(?:\.[a-z0-9]+)*)\1/g;
const SYMBOL_CONTEXT = /icon|symbol|glyph|chevron|name=/i;
const SYMBOL_FILES = /profiles\/ProfileIcons\.tsx$/;
const ICON_KEYS = /^(icon|icons|symbol|name|glyph|chevron|fallback)$/i;
const KEYED = /([A-Za-z_$][\w$]*)\??\s*[:=]\s*\{?\s*(?:(["'`])[^"'`]*\2\s*\|\s*)*$/;
const COMPARED = /(===|!==|==|!=|case)\s*$/;
const NOT_A_SYMBOL = /typeof |kind ===|step ===|type Step|e\.key|command ===|MOD_ORDER|case "|LiveError|Outcome|APP_SCOPE|field:|params:/;

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { if (entry !== "node_modules" && entry !== "__tests__") walk(path); }
      else if (/\.(tsx?|jsx?)$/.test(entry) && !/\.test\./.test(entry)) files.push(path);
    }
  };
  for (const root of ROOTS) walk(join(REPO, root));
  return files;
}

function pickerSymbols(source) {
  const start = source.indexOf("const SYMBOLS");
  if (start < 0) return [];
  return [...source.slice(start, source.indexOf("];", start)).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

export function collectAppSymbols(vocabulary) {
  const found = new Map();
  const add = (name, where) => { if (!found.has(name)) found.set(name, []); found.get(name).push(where); };
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const relative = file.slice(REPO.length);
    if (relative.endsWith("IconPicker.tsx")) for (const name of pickerSymbols(source)) add(name, `${relative} SYMBOLS`);
    source.split("\n").forEach((rawLine, index) => {
      const line = rawLine.replace(/hint\([^)]*\)/g, "").replace(/modifiers:\s*\[[^\]]*\]/g, "").replace(/keywords:\s*\[[^\]]*\]/g, "");
      const symbolish = SYMBOL_CONTEXT.test(line) || SYMBOL_FILES.test(relative);
      if (!symbolish || (NOT_A_SYMBOL.test(line) && !/symbol:|icon:|name=|icons=/.test(line))) return;
      for (const match of line.matchAll(LITERAL)) {
        if (!vocabulary.has(match[2])) continue;
        const before = line.slice(0, match.index);
        if (COMPARED.test(before)) continue;
        const key = before.match(KEYED)?.[1];
        if (key && !ICON_KEYS.test(key) && !/ICON|SYMBOL|GLYPH/.test(key)) continue;
        add(match[2], `${relative}:${index + 1}`);
      }
    });
  }
  return found;
}
