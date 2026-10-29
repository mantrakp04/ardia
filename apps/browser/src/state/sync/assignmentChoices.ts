import { useBrowser } from "../browser/store";
import { confirm } from "../app/system";
import type { SyncDoc, SyncUi } from "./syncDoc";

export function assignmentChoices(current: () => SyncDoc, changed: () => void) {
  function keepSpaceProfile(spaceId: string) {
    const link = current().spaces[spaceId];
    if (!link?.pendingProfileId) return;
    delete link.pendingProfileId;
    link.publishAssignment = true;
    changed();
  }

  async function acceptSpaceProfile(spaceId: string) {
    const profileId = current().spaces[spaceId]?.pendingProfileId;
    if (!profileId || !useBrowser.getState().profiles[profileId]) return;
    const result = await confirm({ title: "Apply synced profile change?", message: "This space will reload with the other profile’s logins. Unsaved form data may be lost.", confirmTitle: "Reload Space" });
    const link = current().spaces[spaceId];
    if (!result.confirmed || link?.pendingProfileId !== profileId) return;
    useBrowser.getState().assignSpaceProfile(spaceId, profileId);
    delete link.pendingProfileId;
    changed();
  }

  return { keepSpaceProfile, acceptSpaceProfile };
}
