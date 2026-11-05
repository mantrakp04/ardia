import { SETTING_SPECS, type Settings, type SettingSpec } from "../settings/settings";

export const SETTINGS_SNAPSHOT_EVENT = "settings_snapshot";

const encode = (value: unknown): string | null => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value * 1000) / 1000);
  return null;
};

const choiceOf = (spec: SettingSpec<unknown>, value: unknown): string | null => (spec.values?.includes(value) && typeof value === "string" ? value : null);

function measured(spec: SettingSpec<unknown>, value: unknown): string | null {
  if (spec.values) return choiceOf(spec, value);
  if (typeof spec.default === "boolean") return typeof value === "boolean" ? encode(value) : null;
  if (typeof spec.default === "number" || spec.default === null) return value === null || typeof value === "number" ? encode(value) : null;
  return null;
}

export function settingsSnapshot(settings: Settings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, spec] of Object.entries(SETTING_SPECS) as [keyof Settings, SettingSpec<unknown>][]) {
    const value = measured(spec, settings[key]);
    const fallback = measured(spec, spec.default);
    if (value === null || fallback === null) continue;
    out[`setting_${key}`] = value;
    out[`default_${key}`] = fallback;
  }
  return out;
}
