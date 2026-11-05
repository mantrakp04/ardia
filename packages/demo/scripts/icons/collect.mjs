import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./paths.mjs";

const ROOTS = ["apps/browser/src"];
const LITERAL = /(["'`])([a-z0-9]+(?:\.[a-z0-9]+)*)\1/g;
const SYMBOL_CONTEXT = /icon|symbol|glyph|chevron|name=/i;
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

const SYMBOL_LIST = /const ([A-Za-z_]*(?:SYMBOLS|ICONS|Icons))\b[^=]*=\s*/g;

function closingBracket(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = source.indexOf(c, i + 1);
      if (i < 0) return source.length;
    } else if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") if (--depth === 0) return i;
  }
  return source.length;
}

function symbolLists(source, vocabulary) {
  const lists = [];
  for (const match of source.matchAll(SYMBOL_LIST)) {
    const open = match.index + match[0].length;
    const bracketed = source[open] === "[" || source[open] === "{";
    const statementEnd = source.slice(open).search(/;\s*\n/);
    const end = bracketed ? closingBracket(source, open) + 1 : statementEnd < 0 ? source.length : open + statementEnd;
    const body = source.slice(open, end);
    const names = [...body.matchAll(/(["'])([^"'\n]+)\1/g)].map((m) => m[2]).filter((name) => vocabulary.has(name));
    lists.push({ list: match[1], names });
  }
  return lists;
}

export function collectAppSymbols(vocabulary) {
  const found = new Map();
  const add = (name, where) => { if (!found.has(name)) found.set(name, []); found.get(name).push(where); };
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const relative = file.slice(REPO.length);
    for (const { list, names } of symbolLists(source, vocabulary)) for (const name of names) add(name, `${relative} ${list}`);
    source.split("\n").forEach((rawLine, index) => {
      const line = rawLine.replace(/hint\([^)]*\)/g, "").replace(/modifiers:\s*\[[^\]]*\]/g, "").replace(/keywords:\s*\[[^\]]*\]/g, "");
      const symbolish = SYMBOL_CONTEXT.test(line);
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
