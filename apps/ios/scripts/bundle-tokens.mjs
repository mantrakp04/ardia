#!/usr/bin/env node
// Usage: node apps/ios/scripts/bundle-tokens.mjs [--check] [--help]
// Writes ArdiaDesign/Tokens.generated.swift from the Mac's design tokens (apps/browser/src/components/ui/tokens.ts,
// ui/motion.ts and window/tokens.ts), with no dependencies. --check exits 1 when the checked-in file is out of date.

import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, "apps/ios/Packages/ArdiaKit/Sources/ArdiaDesign/Tokens.generated.swift");

const SOURCES = {
  tokens: "apps/browser/src/components/ui/tokens.ts",
  motion: "apps/browser/src/components/ui/motion.ts",
  window: "apps/browser/src/components/window/tokens.ts",
};

const easing = new Proxy(
  {},
  { get: (_, name) => (typeof name === "string" ? Object.assign((...args) => ({ easing: name, args }), { easing: name }) : undefined) },
);

const PACKAGE_STUBS = {
  react: { useEffect: () => {}, useRef: () => ({}), useState: () => [] },
  "react-native": { Animated: { Value: class {} }, Easing: easing },
};

const ROLE_KEYS = [
  "textPrimary",
  "textTab",
  "textSecondary",
  "textTertiary",
  "icon",
  "iconDisabled",
  "placeholder",
  "divider",
  "card",
  "cardEdge",
  "panel",
  "panelBorder",
  "scrim",
  "toastFill",
  "tabHover",
  "tabPressed",
  "tabSelected",
  "tabSelectedText",
  "tabSelectedBorder",
  "tabSelectedShadow",
  "pinnedResting",
  "pinnedRestingStroke",
  "pinnedSelectedFill",
  "pinnedSelectedRim",
  "pinnedSelectedOutline",
  "field",
  "fieldBorder",
  "control",
  "controlHover",
  "controlPressed",
  "controlBorder",
  "accent",
  "formAccent",
  "destructive",
  "warning",
  "success",
];

const ROLE_NUMBER_KEYS = ["grain", "panelShadowOpacity", "tabSelectedShadowRadius"];

const WEIGHTS = { 400: "regular", 500: "medium", 600: "semibold", 700: "bold" };

const MONOSPACED_FAMILIES = new Set(["Menlo"]);

const IMPORT_NAMED = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";?[^\S\n]*$/gm;
const IMPORT_NAMESPACE = /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+"([^"]+)";?[^\S\n]*$/gm;
const EXPORT_DECL = /^export\s+((?:async\s+)?function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

const importNames = (list) =>
  list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("type "))
    .map((s) => {
      const [name, alias] = s.split(/\s+as\s+/);
      return { name: name.trim(), alias: (alias ?? name).trim() };
    });

const blank = (text) => text.replace(/[^\n]/g, "");

const lineAt = (code, offset) => code.slice(0, offset).split("\n").length;

function firstLine(code, pattern) {
  const found = pattern.exec(code);
  return found ? lineAt(code, found.index) : null;
}

export function evaluateModule(path, source, resolveImport) {
  const bindings = [];
  const imports = {};
  const bind = (spec, line) => {
    imports[spec] ??= resolveImport(spec, path, line);
    return imports[spec];
  };
  let code = stripTypeScriptTypes(source, { mode: "strip" });
  code = code.replace(IMPORT_NAMED, (match, typeOnly, list, spec, offset, whole) => {
    const names = typeOnly ? [] : importNames(list);
    if (!names.length) return blank(match);
    const line = lineAt(whole, offset);
    const module = bind(spec, line);
    for (const { name } of names) {
      if (!(name in module)) throw new Error(`${path}:${line} imports ${name} from ${spec}, which bundle-tokens can't evaluate`);
    }
    bindings.push(`const { ${names.map((n) => (n.name === n.alias ? n.name : `${n.name}: ${n.alias}`)).join(", ")} } = __imports[${JSON.stringify(spec)}];`);
    return blank(match);
  });
  code = code.replace(IMPORT_NAMESPACE, (match, name, spec, offset, whole) => {
    bind(spec, lineAt(whole, offset));
    bindings.push(`const ${name} = __imports[${JSON.stringify(spec)}];`);
    return blank(match);
  });
  const strayImport = firstLine(code, /^import\s/m);
  if (strayImport) throw new Error(`${path}:${strayImport}: an import form bundle-tokens doesn't know`);
  const exported = [];
  code = code.replace(EXPORT_DECL, (match, _kind, name) => {
    exported.push(name);
    return match.replace(/^export\s+/, "");
  });
  const strayExport = firstLine(code, /^export\s/m);
  if (strayExport) throw new Error(`${path}:${strayExport}: an export form bundle-tokens doesn't know`);
  const prelude = ["(function (__imports) {", ...bindings];
  const body = [...prelude, code, `return { ${exported.join(", ")} };`, "})"].join("\n");
  return vm.runInNewContext(body, {}, { filename: path, lineOffset: -prelude.length })(imports);
}

export function loadMacTokens({ base = root, sources = SOURCES } = {}) {
  const loaded = new Map();
  const load = (path) => {
    if (!loaded.has(path)) {
      const resolveImport = (spec, from, line) => {
        if (Object.hasOwn(PACKAGE_STUBS, spec)) return PACKAGE_STUBS[spec];
        const target = relative(base, resolve(base, dirname(from), spec)) + ".ts";
        if (!spec.startsWith(".") || !existsSync(join(base, target))) {
          throw new Error(`${from}:${line} imports ${spec}, which bundle-tokens can't evaluate`);
        }
        return load(target);
      };
      loaded.set(path, evaluateModule(path, readFileSync(join(base, path), "utf8"), resolveImport));
    }
    return loaded.get(path);
  };
  return Object.fromEntries(Object.entries(sources).map(([key, path]) => [key, JSON.parse(JSON.stringify(load(path)))]));
}

export function swiftNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`not a number: ${value}`);
  return String(Number(Math.abs(value) < 1 ? value.toPrecision(4) : value.toFixed(4)));
}

function parseColor(color) {
  const unreadable = () => new Error(`a colour bundle-tokens can't read: ${color}`);
  const text = color.trim();
  const rgb = /^rgba?\(([^)]*)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    if ((parts.length !== 3 && parts.length !== 4) || !parts.every((part) => NUMBER.test(part))) throw unreadable();
    const [r, g, b, a = 1] = parts.map(Number);
    if (![r, g, b].every((channel) => channel >= 0 && channel <= 255) || a < 0 || a > 1) throw unreadable();
    return [r, g, b, a];
  }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (!hex) throw unreadable();
  const digits = hex[1].length <= 4 ? [...hex[1]].map((digit) => digit + digit).join("") : hex[1];
  const channel = (index) => parseInt(digits.slice(2 * index, 2 * index + 2), 16);
  return [channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) / 255 : 1];
}

export function swiftColor(color) {
  const [r, g, b, a] = parseColor(color);
  const channel = (v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();
  return `TokenColor(hex: 0x${channel(r)}${channel(g)}${channel(b)}, opacity: ${swiftNumber(a)})`;
}

const schemeColor = (dark, light) => `SchemeColor(dark: ${swiftColor(dark)}, light: ${swiftColor(light)})`;

const constant = (name, type, value) => `    public static let ${name}${type ? `: ${type}` : ""} = ${value}`;

const group = (name, lines) => [`  public enum ${name} {`, ...lines, `  }`].join("\n");

const numbers = (object, type, scale = 1) =>
  Object.entries(object)
    .filter(([key]) => key !== "none")
    .map(([key, value]) => constant(key, type, swiftNumber(value * scale)));

function typeToken({ fontSize, letterSpacing = 0, fontFamily }) {
  if (fontFamily !== undefined && !MONOSPACED_FAMILIES.has(fontFamily)) throw new Error(`a font family bundle-tokens doesn't map: ${fontFamily}`);
  return `TypeToken(size: ${swiftNumber(fontSize)}, tracking: ${swiftNumber(letterSpacing)}, isMonospaced: ${fontFamily !== undefined})`;
}

function weightName(value) {
  const name = WEIGHTS[value];
  if (!name) throw new Error(`a font weight bundle-tokens doesn't map: ${value}`);
  return `.${name}`;
}

const springToken = ({ response, damping }) => `SpringToken(response: ${swiftNumber(response)}, dampingFraction: ${swiftNumber(damping)})`;

function shadowToken({ color, opacity, radius, offset }) {
  const [x, y] = offset;
  return `ShadowToken(color: ${swiftColor(color)}, radius: ${swiftNumber(radius)}, x: ${swiftNumber(x)}, y: ${swiftNumber(y)}, opacity: SchemeValue(dark: ${swiftNumber(opacity.dark)}, light: ${swiftNumber(opacity.light)}))`;
}

function roleLines({ dark, light }, arcSelectedFill) {
  const lines = ROLE_KEYS.flatMap((key) => {
    if (Array.isArray(dark[key])) {
      return [
        constant(`${key}Top`, null, schemeColor(dark[key][0], light[key][0])),
        constant(`${key}Bottom`, null, schemeColor(dark[key][1], light[key][1])),
      ];
    }
    if (typeof dark[key] !== "string") throw new Error(`colorRoles.${key} is not a colour`);
    return [constant(key, null, schemeColor(dark[key], light[key]))];
  });
  return [...lines, constant("arcSelectedFill", null, schemeColor(arcSelectedFill.dark, arcSelectedFill.light))];
}

const roleValueLines = ({ dark, light }) =>
  ROLE_NUMBER_KEYS.map((key) => constant(key, null, `SchemeValue(dark: ${swiftNumber(dark[key])}, light: ${swiftNumber(light[key])})`));

export function renderSwift({ tokens, motion, window }) {
  const sections = [
    group("Space", numbers(tokens.space, "CGFloat")),
    group("Radius", numbers(tokens.radius, "CGFloat")),
    group("FontSize", Object.entries(tokens.font).map(([key, value]) => constant(key, "CGFloat", swiftNumber(value.fontSize)))),
    group("LineHeight", numbers(tokens.lineHeight, "CGFloat")),
    group("Tracking", numbers(tokens.tracking, "CGFloat")),
    group("Display", Object.entries(tokens.display).map(([key, value]) => constant(key, null, typeToken(value)))),
    group("Weight", Object.entries(tokens.weight).map(([key, value]) => constant(key, "Font.Weight", weightName(value)))),
    group("Hairline", numbers(tokens.hairline, "CGFloat")),
    group("Opacity", numbers(tokens.opacity, "Double")),
    group("Duration", [
      ...numbers(motion.duration, "Double", 1 / 1000),
      constant("sidebarPeekOut", "Double", swiftNumber(window.ARC_PEEK_OUT_MS / 1000)),
    ]),
    group("Spring", [
      ...Object.entries(motion.springSpec).map(([key, value]) => constant(key, null, springToken(value))),
      constant("sidebarDock", null, springToken(window.DOCK_SPRING)),
      constant("sidebarPeek", null, springToken(window.ARC_PEEK_SPRING)),
    ]),
    group("Shadow", Object.entries(tokens.shadow).map(([key, value]) => constant(key, null, shadowToken(value)))),
    group("Role", roleLines(tokens.colorRoles, tokens.arcSelectedFill)),
    group("RoleValue", roleValueLines(tokens.colorRoles)),
  ];
  return [`import SwiftUI`, ``, `public enum Tokens {`, sections.join("\n\n"), `}`, ``].join("\n");
}

function main() {
  if (process.argv.includes("--help")) {
    const header = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1).filter((line) => line.startsWith("// "));
    console.log(header.map((line) => line.slice(3)).join("\n"));
    return 0;
  }
  const text = renderSwift(loadMacTokens());
  if (process.argv.includes("--check")) {
    if (existsSync(out) && readFileSync(out, "utf8") === text) return 0;
    console.error(`${relative(root, out)} is out of date: run node apps/ios/scripts/bundle-tokens.mjs`);
    return 1;
  }
  writeFileSync(out, text);
  console.log(`${relative(root, out)} (${(text.length / 1024).toFixed(0)} KB)`);
  return 0;
}

function startedDirectly() {
  if (!process.argv[1] || !existsSync(process.argv[1])) return false;
  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
}

if (startedDirectly()) process.exit(main());
