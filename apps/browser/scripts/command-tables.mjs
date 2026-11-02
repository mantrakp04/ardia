#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

await import("../src/test-loader.mjs");
const { COMMANDS, staticShortcutSources } = await import("../src/state/commands/commandCatalog.ts");

export const TABLE_FILES = {
  union: new URL("../../../packages/shell/src/browserCommand.ts", import.meta.url),
  swift: new URL("../../../packages/shell/ios/CommandTable.swift", import.meta.url),
};

const swiftString = (text) =>
  `"${Array.from(text)
    .map((c) => {
      const code = c.codePointAt(0);
      if (c === '"' || c === "\\") return `\\${c}`;
      if (code < 0x20 || code === 0x7f || (code >= 0xe000 && code <= 0xf8ff)) return `\\u{${code.toString(16).toUpperCase()}}`;
      return c;
    })
    .join("")}"`;

function titles() {
  const entries = [];
  for (const [command, spec] of Object.entries(COMMANDS)) {
    if (spec.title) entries.push([command, spec.title]);
    for (const [arg, variant] of Object.entries(spec.variants ?? {})) if (variant.title) entries.push([`${command}:${arg}`, variant.title]);
  }
  return entries;
}

export function renderUnion() {
  return `export type BrowserCommand =\n${Object.keys(COMMANDS)
    .map((command) => `  | "${command}"`)
    .join("\n")};\n`;
}

export function renderSwift() {
  const keyed = staticShortcutSources().filter((source) => source.keys.length);
  const shortcut = ({ key, modifiers }) => `(${swiftString(key)}, [${modifiers.map((m) => `.${m}`).join(", ")}])`;
  return [
    "import AppKit",
    "",
    "enum CommandTable {",
    "  enum Command: String {",
    ...Object.keys(COMMANDS).map((command) => `    case ${command}`),
    "  }",
    "",
    "  static let titles: [String: String] = [",
    ...titles().map(([id, title]) => `    ${swiftString(id)}: ${swiftString(title)},`),
    "  ]",
    "",
    "  static let keys: [String: [(key: String, mods: NSEvent.ModifierFlags)]] = [",
    ...keyed.map((source) => `    ${swiftString(source.id)}: [${source.keys.map(shortcut).join(", ")}],`),
    "  ]",
    "}",
    "",
  ].join("\n");
}

const HELP = `Writes the tables generated from apps/browser/src/state/commands/commandCatalog.ts:
packages/shell/src/browserCommand.ts (the BrowserCommand union) and packages/shell/ios/CommandTable.swift
(the menu bar's titles and default keys). commandCatalog.test.mjs fails when either file drifts from the catalog.

  node apps/browser/scripts/command-tables.mjs`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  for (const [file, text] of [
    [TABLE_FILES.union, renderUnion()],
    [TABLE_FILES.swift, renderSwift()],
  ]) {
    let current = "";
    try {
      current = readFileSync(file, "utf8");
    } catch {}
    if (current !== text) writeFileSync(file, text);
  }
}
