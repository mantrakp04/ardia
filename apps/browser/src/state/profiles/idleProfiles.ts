export const PROFILE_IDLE_MS = 5 * 60_000;

export function idleProfiles() {
  const idleSince = new Map<string, number>();
  return (loaded: Iterable<string>, inUse: ReadonlySet<string>, now: number): string[] => {
    const profiles = new Set(loaded);
    for (const profile of idleSince.keys()) {
      if (!profiles.has(profile) || inUse.has(profile)) idleSince.delete(profile);
    }
    const ready: string[] = [];
    for (const profile of profiles) {
      if (inUse.has(profile)) continue;
      if (!idleSince.has(profile)) idleSince.set(profile, now);
      if (now - idleSince.get(profile)! >= PROFILE_IDLE_MS) ready.push(profile);
    }
    return ready;
  };
}
