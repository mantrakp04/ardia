import { storeAction, storeTransaction, useBrowser } from "../browser/store";
import { confirm } from "../app/system";
import { profileDeletion } from "./deletion";

export const createProfile = storeAction("createProfile");
export const updateProfile = storeAction("updateProfile");
export const deleteProfile = storeAction("deleteProfile");

export async function requestDeleteProfile(id: string): Promise<boolean> {
  const choice = profileDeletion(useBrowser.getState(), id);
  if (!choice) return false;
  if (choice.blocked) {
    await confirm({ title: "Cannot Delete Profile", message: choice.message, confirmTitle: "OK" });
    return false;
  }
  const result = await confirm({ title: "Delete Profile?", message: choice.message, confirmTitle: choice.confirmTitle, cancelTitle: "Cancel", destructive: true });
  if (!result.confirmed) return false;
  storeTransaction(() => useBrowser.getState().deleteProfile(id, choice.replacementId));
  if (!useBrowser.getState().profiles[id]) return true;
  const current = profileDeletion(useBrowser.getState(), id);
  await confirm({ title: "Profile Was Not Deleted", message: current?.blocked ? current.message : "Profiles changed while this dialog was open. Try deleting the profile again.", confirmTitle: "OK" });
  return false;
}
