import type { ShortcutOverrides } from "../../browser/src/state/commands/shortcuts";

export function migrateProfileShortcuts(overrides: ShortcutOverrides, profiles: readonly string[]): ShortcutOverrides {
  const legacy = overrides.switchProfile;
  if (!legacy || !profiles.length) return overrides;
  const { switchProfile: _legacy, ...migrated } = overrides;
  for (const [index, profile] of profiles.entries()) {
    const id = `switchProfile:${profile}`;
    if (!(id in migrated)) migrated[id] = index === 0 ? [...legacy] : [""];
  }
  return migrated;
}

export const SHIFTED_KEYS: Readonly<Record<string, string>> = { "+": "=", "{": "[", "}": "]" };

export function unshiftedShortcutOverrides(overrides: ShortcutOverrides): ShortcutOverrides {
  let canonical: ShortcutOverrides | undefined;
  for (const [id, [key = "", ...modifiers]] of Object.entries(overrides)) {
    if (!Object.hasOwn(SHIFTED_KEYS, key)) continue;
    const base = SHIFTED_KEYS[key]!;
    (canonical ??= { ...overrides })[id] = [base, ...modifiers.filter((modifier) => modifier !== "shift"), "shift"];
  }
  return canonical ?? overrides;
}
