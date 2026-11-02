import { BUILT_IN_ENGINES } from "@ardia/core";
import { JSON_SCHEMA_DIALECT, schemaJson, type JsonSchema } from "../../lib/jsonSchema";
import { THEME_NAME, themeSchema, type RolePalettes } from "../../lib/themeFile";
import { CONFIG_SETTING_KEYS } from "../settings/configAllowlist";
import { SETTING_SPECS } from "../settings/settings";
import { SHORTCUT_FORMAT, shortcutCatalog, shortcutDescription } from "./configShortcuts";

export const CONFIG_SCHEMA_FILE = "config.schema.json";
export const THEME_SCHEMA_FILE = "theme.schema.json";

function shortcutsSchema(): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [id, entry] of shortcutCatalog()) properties[id] = { type: "string", description: shortcutDescription(entry) };
  return { type: "object", description: `Command id to shortcut. ${SHORTCUT_FORMAT} A command left out keeps what it has.`, properties, additionalProperties: false, default: {} };
}

function settingSchema(key: (typeof CONFIG_SETTING_KEYS)[number]): JsonSchema {
  if (key === "shortcuts") return shortcutsSchema();
  const spec = SETTING_SPECS[key];
  const schema: JsonSchema = { ...spec.schema, default: spec.default };
  if (key === "searchEngine") schema.description = `An engine id: ${BUILT_IN_ENGINES.map((e) => e.id).join(", ")}, or one added in Settings`;
  return schema;
}

export function configSchema(): object {
  return {
    $schema: JSON_SCHEMA_DIALECT,
    description: "Ardia's config.json. Ardia applies it at launch and whenever it changes; it never writes it.",
    type: "object",
    properties: {
      $schema: { type: "string" },
      theme: { type: ["string", "null"], pattern: THEME_NAME.source, description: "A theme in themes/<name>.json, or null for Ardia's own", default: null },
      settings: {
        type: "object",
        properties: Object.fromEntries(CONFIG_SETTING_KEYS.map((key) => [key, settingSchema(key)])),
        additionalProperties: false,
      },
    },
  };
}

export const schemaFiles = (roles: RolePalettes): Record<string, string> => ({
  [CONFIG_SCHEMA_FILE]: schemaJson(configSchema()),
  [THEME_SCHEMA_FILE]: schemaJson(themeSchema(roles)),
});
