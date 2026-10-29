#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const USAGE = `usage: page-operations.mjs [--check|--write]
Derives the page evaluations the Linux host may run from the shared browser sources
and pins their exact text by length and SHA-256 in ac_linux_page_operations.h.`;

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const TABLE = `${ROOT}engine/ardiacore-linux/src/ardia/linux/ac_linux_page_operations.h`;
const SELECTION = "apps/browser/src/state/site/selection.ts";
const COMMANDS = "apps/browser/src/state/commands/commands.ts";

function parse(path) {
  return ts.createSourceFile(path, readFileSync(`${ROOT}${path}`, "utf8"), ts.ScriptTarget.Latest, true);
}

function constants(source) {
  const found = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isNoSubstitutionTemplateLiteral(node.initializer) || ts.isTemplateExpression(node.initializer) || ts.isStringLiteral(node.initializer))) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const resolve = (name, seen = new Set()) => {
    const node = found.get(name);
    if (!node || seen.has(name)) throw new Error(`cannot resolve ${name}`);
    seen.add(name);
    if (!ts.isTemplateExpression(node)) return node.text;
    let text = node.head.text;
    for (const span of node.templateSpans) {
      if (!ts.isIdentifier(span.expression)) throw new Error(`${name} interpolates a non-constant`);
      text += resolve(span.expression.text, new Set(seen)) + span.literal.text;
    }
    return text;
  };
  return resolve;
}

function evaluatedLiteral(source, clause) {
  let result = null;
  const visit = (node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === clause) {
      const inner = (child) => {
        if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "evaluate" &&
            child.arguments.length === 1 && ts.isStringLiteral(child.arguments[0])) result = child.arguments[0].text;
        ts.forEachChild(child, inner);
      };
      inner(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (result === null) throw new Error(`no evaluate literal under case ${clause}`);
  return result;
}

export function pageOperations() {
  const selection = constants(parse(SELECTION));
  return [
    { name: "selectionContext", text: selection("SELECTION_CONTEXT"), args: "kNone" },
    { name: "hasSelection", text: selection("HAS_SELECTION"), args: "kNone" },
    { name: "jumpToSelection", text: selection("JUMP_TO_SELECTION"), args: "kNone" },
    { name: "replaceInField", text: `(${selection("REPLACE")})(`, args: "kReplace" },
    { name: "selectedText", text: evaluatedLiteral(parse(COMMANDS), "useSelectionForFind"), args: "kNone" },
  ];
}

export function pageOperationsHeader(operations = pageOperations()) {
  const rows = operations.map(({ name, text, args }) => {
    const bytes = Buffer.from(text, "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    return `    {"${name}", ${bytes.length}, "${digest}", LinuxPageOperationArgs::${args}},`;
  });
  return [
    "#ifndef ARDIA_LINUX_AC_LINUX_PAGE_OPERATIONS_H_",
    "#define ARDIA_LINUX_AC_LINUX_PAGE_OPERATIONS_H_",
    "",
    "#include <stddef.h>",
    "",
    "#include <array>",
    "#include <string_view>",
    "",
    "namespace ardiacore {",
    "",
    "enum class LinuxPageOperationArgs { kNone, kReplace };",
    "",
    "struct LinuxPageOperation {",
    "  std::string_view name;",
    "  size_t length;",
    "  std::string_view sha256;",
    "  LinuxPageOperationArgs args;",
    "};",
    "",
    `inline constexpr std::array<LinuxPageOperation, ${rows.length}> kLinuxPageOperations = {{`,
    ...rows,
    "}};",
    "",
    "}",
    "",
    "#endif",
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--write") {
    console.error(USAGE);
    process.exit(64);
  }
  const header = pageOperationsHeader();
  if (mode === "--write") writeFileSync(TABLE, header);
  else if (readFileSync(TABLE, "utf8") !== header) {
    console.error("ac_linux_page_operations.h is stale: run apps/linux/scripts/page-operations.mjs --write");
    process.exit(1);
  }
}
