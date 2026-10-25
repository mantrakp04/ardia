#!/usr/bin/env node
// Usage: node apps/ios/scripts/bundle-shared.mjs [--check] [--help]
// Bundles the TypeScript the iPhone app shares with the Mac (packages/sync, packages/core) into plain scripts
// for JavaScriptCore, with no dependencies. --check exits 1 when a checked-in bundle is out of date.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "apps/ios/Packages/ArdiaKit/Sources/ArdiaShared/Scripts");

const BUNDLES = [
  { file: "ardia-sync.js", global: "ArdiaSync", entry: "packages/sync/src/companion/index.ts" },
  { file: "ardia-core.js", global: "ArdiaCore", entry: "packages/core/src/mobile.ts" },
];

const IMPORT = /^import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+"([^"]+)";?[^\S\n]*$/gm;
const EXPORT_FROM = /^export\s+(?:\*|\{([^}]*)\})\s+from\s+"([^"]+)";?[^\S\n]*$/gm;
const EXPORT_DECL = /^export\s+(?:(async\s+)?function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s+\{([^}]*)\};?[^\S\n]*$/gm;

const names = (list) =>
  list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("type "))
    .map((s) => {
      const [name, alias] = s.split(/\s+as\s+/);
      return { name: name.trim(), alias: (alias ?? name).trim() };
    });

function bundle({ entry, global }) {
  const modules = new Map();
  const visit = (path) => {
    if (modules.has(path)) return;
    const source = readFileSync(join(root, path), "utf8");
    let code = stripTypeScriptTypes(source, { mode: "strip" });
    const deps = [];
    const exported = [];
    const reexports = [];
    const dep = (spec) => {
      if (!spec.startsWith(".")) throw new Error(`${path}: only relative imports can be bundled (${spec})`);
      const target = relative(root, resolve(root, dirname(path), spec));
      deps.push(target);
      return target;
    };
    code = code.replace(EXPORT_FROM, (_, list, spec) => {
      const target = dep(spec);
      reexports.push({ target, list: list === undefined ? null : names(list) });
      return "";
    });
    code = code.replace(IMPORT, (_, list, star, spec) => {
      const target = dep(spec);
      if (star) return `const ${star} = __require(${JSON.stringify(target)});`;
      const bound = names(list);
      if (!bound.length) return "";
      return `const { ${bound.map((b) => (b.name === b.alias ? b.name : `${b.name}: ${b.alias}`)).join(", ")} } = __require(${JSON.stringify(target)});`;
    });
    code = code.replace(EXPORT_LIST, (_, list) => {
      for (const b of names(list)) exported.push({ local: b.name, as: b.alias });
      return "";
    });
    code = code.replace(EXPORT_DECL, (match, _async, name) => {
      exported.push({ local: name, as: name });
      return match.replace(/^export\s+/, "");
    });
    if (/^export\s/m.test(code)) throw new Error(`${path}: an export form the bundler doesn't know`);
    if (/^import\s/m.test(code)) throw new Error(`${path}: an import form the bundler doesn't know`);
    modules.set(path, { code, exported, reexports });
    deps.forEach(visit);
  };
  visit(entry);
  const parts = [...modules].map(([path, { code, exported, reexports }]) => {
    const getters = exported.map((e) => `  __export(exports, ${JSON.stringify(e.as)}, () => ${e.local});`);
    const forwards = reexports.map(({ target, list }) =>
      list === null
        ? `  __exportAll(exports, __require(${JSON.stringify(target)}));`
        : list.map((b) => `  __export(exports, ${JSON.stringify(b.alias)}, () => __require(${JSON.stringify(target)})[${JSON.stringify(b.name)}]);`).join("\n"),
    );
    return `__define(${JSON.stringify(path)}, function (exports, __require) {\n${[...getters, ...forwards].join("\n")}\n${code}\n});`;
  });
  return [
    `"use strict";`,
    `(function () {`,
    `const __factories = new Map();`,
    `const __cache = new Map();`,
    `const __define = (path, factory) => __factories.set(path, factory);`,
    `const __export = (target, name, get) => Object.defineProperty(target, name, { get, enumerable: true, configurable: true });`,
    `const __exportAll = (target, source) => { for (const name of Object.keys(source)) if (name !== "default" && !(name in target)) __export(target, name, () => source[name]); };`,
    `const __require = (path) => {`,
    `  if (__cache.has(path)) return __cache.get(path);`,
    `  const exports = {};`,
    `  __cache.set(path, exports);`,
    `  __factories.get(path)(exports, __require);`,
    `  return exports;`,
    `};`,
    ...parts,
    `globalThis.${global} = __require(${JSON.stringify(entry)});`,
    `})();`,
    ``,
  ].join("\n");
}

if (process.argv.includes("--help")) {
  const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((line) => line.startsWith("// "));
  console.log(header.map((line) => line.slice(3)).join("\n"));
  process.exit(0);
}

const check = process.argv.includes("--check");
let stale = false;
for (const b of BUNDLES) {
  const text = bundle(b);
  const path = join(out, b.file);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
      console.error(`${relative(root, path)} is out of date: run node apps/ios/scripts/bundle-shared.mjs`);
      stale = true;
    }
  } else {
    writeFileSync(path, text);
    console.log(`${relative(root, path)} (${(text.length / 1024).toFixed(0)} KB)`);
  }
}
process.exit(stale ? 1 : 0);
