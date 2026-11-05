import { isFields } from "./decode";
import { JSON_SCHEMA_DIALECT, type JsonSchema } from "./jsonSchema";
import { toHex } from "./color";

export type RoleValue = string | number | boolean | readonly [string, string];
export type RolePalette = Readonly<Record<string, RoleValue>>;
export type RolePalettes = { readonly dark: RolePalette; readonly light: RolePalette };
export type BasePalette = RolePalettes & { readonly revision: number };
export type ThemeRoles = { readonly dark: Readonly<Record<string, RoleValue>>; readonly light: Readonly<Record<string, RoleValue>> };
export type ThemeMode = keyof RolePalettes;
export type ParsedTheme = { roles: ThemeRoles | null; problems: string[] };

export const THEME_NAME = /^[a-z0-9][a-z0-9_-]*$/;
export const THEME_MODES: readonly ThemeMode[] = ["dark", "light"];

const CHANNEL = String.raw`\s*(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\s*`;
const ALPHA = String.raw`\s*(0|1|0?\.\d+|1\.0+)\s*`;
export const COLOR_PATTERN = String.raw`^(?:#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|rgb\(${CHANNEL},${CHANNEL},${CHANNEL}\)|rgba\(${CHANNEL},${CHANNEL},${CHANNEL},${ALPHA}\))$`;
const COLOR = new RegExp(COLOR_PATTERN);
const COLOR_RULE = "a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)";

export function themeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = COLOR.exec(value);
  if (!m) return null;
  if (value.startsWith("#")) {
    const digits = value.slice(1);
    const full = digits.length === 3 ? Array.from(digits, (c) => c + c).join("") : digits;
    return `#${full.toUpperCase()}`;
  }
  const [r, g, b] = [m[1] ?? m[4], m[2] ?? m[5], m[3] ?? m[6]].map(Number) as [number, number, number];
  const a = m[7] === undefined ? 1 : Number(m[7]);
  return toHex(a === 1 ? [r, g, b] : [r, g, b, a * 255]);
}

type RoleKind = { kind: "color" } | { kind: "pair" } | { kind: "number"; minimum?: number; maximum?: number };

function numberRange(role: string): { minimum?: number; maximum?: number } {
  if (role === "grain" || role.endsWith("Opacity")) return { minimum: 0, maximum: 1 };
  if (role.endsWith("Radius")) return { minimum: 0, maximum: 100 };
  return {};
}

export function roleKind(role: string, value: RoleValue): RoleKind | null {
  if (typeof value === "string") return { kind: "color" };
  if (typeof value === "number") return { kind: "number", ...numberRange(role) };
  if (Array.isArray(value)) return { kind: "pair" };
  return null;
}

type Checked = { value: RoleValue } | { error: string };

function checkedRole(kind: RoleKind, value: unknown): Checked {
  if (kind.kind === "color") {
    const color = themeColor(value);
    return color ? { value: color } : { error: `must be ${COLOR_RULE}` };
  }
  if (kind.kind === "pair") {
    const pair = Array.isArray(value) && value.length === 2 ? value.map(themeColor) : null;
    return pair?.[0] && pair[1] ? { value: [pair[0], pair[1]] } : { error: `must be two colours, each ${COLOR_RULE}` };
  }
  const { minimum, maximum } = kind;
  const inRange = typeof value === "number" && Number.isFinite(value) && (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum);
  if (inRange) return { value };
  return { error: minimum === undefined ? "must be a number" : `must be a number from ${minimum} to ${maximum}` };
}

export function parseThemeFile(file: string, text: string, defaults: RolePalettes): ParsedTheme {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { roles: null, problems: [`${file}: isn't valid JSON (${(error as Error).message})`] };
  }
  if (!isFields(doc)) return { roles: null, problems: [`${file}: must be an object`] };
  const problems: string[] = [];
  for (const key of Object.keys(doc)) if (key !== "$schema" && key !== "dark" && key !== "light") problems.push(`${file}: ${key} isn't a theme key (dark, light)`);
  const roles = { dark: {} as Record<string, RoleValue>, light: {} as Record<string, RoleValue> };
  for (const mode of THEME_MODES) {
    const given = doc[mode];
    if (given === undefined) continue;
    if (!isFields(given)) {
      problems.push(`${file}: ${mode} must be an object of colour roles`);
      continue;
    }
    for (const [role, value] of Object.entries(given)) {
      const known = Object.hasOwn(defaults[mode], role) ? roleKind(role, defaults[mode][role]!) : null;
      if (!known) {
        problems.push(`${file}: ${mode}.${role} isn't a colour role`);
        continue;
      }
      const checked = checkedRole(known, value);
      if ("error" in checked) problems.push(`${file}: ${mode}.${role} ${checked.error}`);
      else roles[mode][role] = checked.value;
    }
  }
  return { roles, problems };
}

export function mergedPalettes(defaults: RolePalettes, roles: ThemeRoles | null, revision: number): BasePalette {
  if (!roles) return { revision, dark: defaults.dark, light: defaults.light };
  return { revision, dark: { ...defaults.dark, ...roles.dark }, light: { ...defaults.light, ...roles.light } };
}

function roleSchema(kind: RoleKind, value: RoleValue): JsonSchema {
  const color: JsonSchema = { type: "string", pattern: COLOR_PATTERN };
  if (kind.kind === "color") return { ...color, default: value };
  if (kind.kind === "pair") return { type: "array", prefixItems: [color, color], minItems: 2, maxItems: 2, default: value, description: "Two colours: the top and bottom of the border" };
  return { type: "number", ...(kind.minimum === undefined ? {} : { minimum: kind.minimum, maximum: kind.maximum }), default: value };
}

function modeSchema(mode: ThemeMode, palette: RolePalette): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [role, value] of Object.entries(palette)) {
    const kind = roleKind(role, value);
    if (kind) properties[role] = roleSchema(kind, value);
  }
  return { type: "object", description: `Roles for the ${mode} appearance; a role left out keeps Ardia's value`, properties, additionalProperties: false };
}

export function themeSchema(defaults: RolePalettes): object {
  return {
    $schema: JSON_SCHEMA_DIALECT,
    description: "An Ardia theme: colour roles that replace Ardia's own, per appearance",
    type: "object",
    properties: { $schema: { type: "string" }, dark: modeSchema("dark", defaults.dark), light: modeSchema("light", defaults.light) },
    additionalProperties: false,
  };
}
