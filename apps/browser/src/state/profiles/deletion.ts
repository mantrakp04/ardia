import type { BrowserState } from "../browser/store";
import { sortedProfiles } from "./profiles";

export function profileDeletion(s: BrowserState, id: string) {
  const profiles = sortedProfiles(s.profiles);
  const at = profiles.findIndex((profile) => profile.id === id);
  const profile = profiles[at];
  if (!profile) return null;
  if (profiles.length <= 1) return { blocked: true, message: "Keep at least one profile. Create another profile before deleting this one." };
  if (Object.values(s.windows).some((window) => (window.kind === "private") && window.incognitoEngineId === profile.engineId)) return { blocked: true, message: "Close this profile’s private windows before deleting it. Their browsing session is still in use." };
  const spaces = Object.values(s.spaces).filter((space) => space.profileId === id).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const next = profiles[(at + 1) % profiles.length]!;
  const names = spaces.slice(0, 2).map((space) => space.name).join(", ") + (spaces.length > 2 ? ", and others" : "");
  const reassignment = spaces.length ? `This profile is used in ${names}. Delete Anyway will reassign all its spaces to “${next.name}”. Their pages will reload with that profile’s logins. Unsaved form changes may be lost. ` : "";
  return { blocked: false, spaceIds: spaces.map((space) => space.id), replacementId: next.id, message: `${reassignment}This profile’s browsing data and Top Apps will be removed in the background. Ardia will report any cleanup failure and retry when it next opens. Encrypted sync copies cached on this Mac and stored in the sync folder or other devices are kept. Saved sidebar rows, folders and themes stay with their spaces.`, confirmTitle: spaces.length ? "Delete Anyway" : "Delete Profile" };
}
