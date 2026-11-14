import type { Settings } from "../settings/settings";

export const PROFILE_IDLE_MS = 5 * 60_000;

const DELAYS = { never: null, "5m": PROFILE_IDLE_MS, "15m": 15 * 60_000, "1h": 60 * 60_000, "2h": 120 * 60_000 };

export const profileUnloadDelay = (settings: Pick<Settings, "memorySaver" | "unloadProfilesAfter">): number | null =>
  settings.memorySaver ? DELAYS[settings.unloadProfilesAfter] : null;

export function idleProfiles() {
  const idleSince = new Map<string, number>();
  return (loaded: Iterable<string>, inUse: ReadonlySet<string>, now: number, delayMs: number | null = PROFILE_IDLE_MS): string[] => {
    if (delayMs === null) {
      idleSince.clear();
      return [];
    }
    const profiles = new Set(loaded);
    for (const profile of idleSince.keys()) {
      if (!profiles.has(profile) || inUse.has(profile)) idleSince.delete(profile);
    }
    const ready: string[] = [];
    for (const profile of profiles) {
      if (inUse.has(profile)) continue;
      if (!idleSince.has(profile)) idleSince.set(profile, now);
      if (now - idleSince.get(profile)! >= delayMs) ready.push(profile);
    }
    return ready;
  };
}
