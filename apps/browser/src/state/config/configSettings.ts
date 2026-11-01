import { isFields } from "../../lib/decode";
import type { JsonSchema } from "../../lib/jsonSchema";
import { THEME_NAME } from "../../lib/themeFile";
import { CONFIG_EXCLUDED_KEYS, isConfigSettingKey } from "../settings/configAllowlist";
import { SETTING_SPECS, searchEngines, type SettingKey, type Settings } from "../settings/settings";
import { configShortcuts } from "./configShortcuts";

export const CONFIG_FILE = "config.json";

export type ConfigRead = { patch: Partial<Settings>; theme: string | null | undefined; problems: string[] };

const EXCLUDED: ReadonlySet<string> = new Set(CONFIG_EXCLUDED_KEYS);

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!isFields(a) || !isFields(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

const listed = (values: readonly unknown[]) => {
  const words = values.map(String);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : (words[0] ?? "");
};

export function describeSchema(schema: JsonSchema): string {
  if (schema.enum) return `must be ${listed(schema.enum)}`;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const parts = types.map((type) => {
    if (type === "boolean") return "true or false";
    if (type === "null") return "null";
    if (type === "string") return "a string";
    if (type === "number" || type === "integer") {
      if (schema.minimum !== undefined && schema.maximum !== undefined) return `a number from ${schema.minimum} to ${schema.maximum}`;
      if (schema.exclusiveMinimum !== undefined) return `a number above ${schema.exclusiveMinimum}`;
      return "a number";
    }
    if (type === "array") return schema.prefixItems ? `a list of ${schema.prefixItems.length} numbers above 0` : "a list of strings";
    return "an object";
  });
  return parts.length ? `must be ${listed(parts)}` : "has the wrong shape";
}

function themeOf(doc: Record<string, unknown>, problems: string[]): string | null | undefined {
  if (!Object.hasOwn(doc, "theme") || doc.theme === null) return null;
  if (typeof doc.theme === "string" && THEME_NAME.test(doc.theme)) return doc.theme;
  problems.push(`${CONFIG_FILE}: theme must be a theme name (lowercase letters, digits, - and _) or null`);
  return undefined;
}

type Requested = { values: Partial<Record<SettingKey, unknown>>; theme: string | null | undefined; problems: string[] };

function parsedConfig(text: string): { doc: Record<string, unknown> } | { problem: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { problem: `${CONFIG_FILE}: isn't valid JSON (${(error as Error).message})` };
  }
  return isFields(doc) ? { doc } : { problem: `${CONFIG_FILE}: must be an object` };
}

function withLinkKeysApart(values: Requested["values"], settings: Settings, problems: string[]) {
  if (!("peekModifier" in values) && !("splitLinkModifier" in values)) return;
  const peek = values.peekModifier ?? settings.peekModifier;
  const split = values.splitLinkModifier ?? settings.splitLinkModifier;
  if (peek !== "alt" || split !== "alt") return;
  problems.push(`${CONFIG_FILE}: peekModifier and splitLinkModifier can't both be alt; Peek keeps alt and split view uses altShift`);
  values.peekModifier = "alt";
  values.splitLinkModifier = "altShift";
}

function requested(doc: Record<string, unknown>, settings: Settings): Requested {
  const problems: string[] = [];
  const theme = themeOf(doc, problems);
  const given = Object.hasOwn(doc, "settings") ? doc.settings : {};
  if (!isFields(given)) return { values: {}, theme, problems: [...problems, `${CONFIG_FILE}: settings must be an object`] };
  const values: Requested["values"] = {};
  for (const [key, value] of Object.entries(given)) {
    if (EXCLUDED.has(key)) {
      problems.push(`${CONFIG_FILE}: ${key} can't be set from a file`);
      continue;
    }
    if (!isConfigSettingKey(key)) {
      problems.push(`${CONFIG_FILE}: ${key} isn't a setting`);
      continue;
    }
    if (key === "shortcuts") {
      const result = configShortcuts(CONFIG_FILE, value, settings.shortcuts);
      problems.push(...result.problems);
      values.shortcuts = result.overrides;
      continue;
    }
    const spec = SETTING_SPECS[key];
    if (!spec.valid(value)) {
      problems.push(`${CONFIG_FILE}: ${key} ${describeSchema(spec.schema)}`);
      continue;
    }
    if (key === "searchEngine") {
      const engines = searchEngines(settings).map((e) => e.id);
      if (!engines.includes(value as string)) {
        problems.push(`${CONFIG_FILE}: searchEngine must name an existing engine (${listed(engines)})`);
        continue;
      }
    }
    values[key] = value;
  }
  withLinkKeysApart(values, settings, problems);
  return { values, theme, problems };
}

export function readConfig(text: string, settings: Settings): ConfigRead {
  const parsed = parsedConfig(text);
  if ("problem" in parsed) return { patch: {}, theme: undefined, problems: [parsed.problem] };
  const { values, theme, problems } = requested(parsed.doc, settings);
  const patch: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, value] of Object.entries(values) as [SettingKey, unknown][]) if (!sameValue(value, settings[key])) patch[key] = value;
  return { patch: patch as Partial<Settings>, theme, problems };
}

export function launchRestoreSession(text: string, settings: Settings): boolean | undefined {
  const parsed = parsedConfig(text);
  if ("problem" in parsed) return undefined;
  const value = requested(parsed.doc, settings).values.restoreSession;
  return typeof value === "boolean" ? value : undefined;
}
