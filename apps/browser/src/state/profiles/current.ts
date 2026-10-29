import { useBrowser } from "../browser/store";

export function currentProfileId(id?: string | null): string {
  const s = useBrowser.getState();
  if (id && s.profiles[id]) return id;
  const space = s.spaces[id ?? s.settings.defaultSpaceId];
  if (!space || !s.profiles[space.profileId]) throw new Error("That browsing profile is unavailable.");
  return space.profileId;
}

export function profileEngine(id: string): string {
  const profile = useBrowser.getState().profiles[id];
  if (!profile) throw new Error("That browsing profile is unavailable.");
  return profile.engineId;
}

export const profileIdForEngine = (engine: string): string | undefined => Object.values(useBrowser.getState().profiles).find((profile) => profile.engineId === engine)?.id;
