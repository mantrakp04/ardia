import { privateSession } from "../browser/model";
import { useBrowser } from "../browser/store";

export function currentProfileId(profileId?: string | null): string {
  const s = useBrowser.getState();
  const selected = profileId ?? profileIdForSpace(s.settings.defaultSpaceId);
  if (!s.profiles[selected]) throw new Error("That browsing profile is unavailable.");
  return selected;
}

export function profileIdForSpace(spaceId: string): string {
  const s = useBrowser.getState();
  const engine = privateSession(s, spaceId);
  const profileId = engine !== null ? profileIdForEngine(engine) : s.spaces[spaceId]?.profileId;
  if (!profileId || !s.profiles[profileId]) throw new Error("That browsing profile is unavailable.");
  return profileId;
}

export function profileEngine(id: string): string {
  const profile = useBrowser.getState().profiles[id];
  if (!profile) throw new Error("That browsing profile is unavailable.");
  return profile.engineId;
}

export const profileIdForEngine = (engine: string): string | undefined => Object.values(useBrowser.getState().profiles).find((profile) => profile.engineId === engine)?.id;
