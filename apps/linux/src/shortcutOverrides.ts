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
