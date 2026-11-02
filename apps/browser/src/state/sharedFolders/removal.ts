import { confirm } from "../../platform/dialogs";
import { sharedFoldersAvailable, sharedLocation } from "../../platform/sharedFolders";
import { useBrowser, type BrowserState } from "../browser/store";
import { isIncognitoProfile, pinKeyOf } from "../browser/model";
import { groupLabel } from "../pins/tabGrouping";
import { sharedFolderOf, type SharedFolder } from "./store";

const store = () => useBrowser.getState();

export function sharedFolderOfGroup(s: Pick<BrowserState, "groups">, groupId: string): { profileId: string; key: string; folder: SharedFolder } | null {
  const g = s.groups[groupId];
  if (!g?.pinned || g.parentId) return null;
  const key = pinKeyOf(g);
  const folder = sharedFolderOf(g.profileId, key);
  return folder ? { profileId: g.profileId, key, folder } : null;
}

export const canShareGroup = (s: Pick<BrowserState, "groups">, groupId: string) => {
  const g = s.groups[groupId];
  return sharedFoldersAvailable() && !!g?.pinned && !g.parentId && !isIncognitoProfile(g.profileId);
};

export const canAddSharedFolder = (profileId: string | undefined) => sharedFoldersAvailable() && !!profileId && !isIncognitoProfile(profileId);

export function folderLabel(path: string): string {
  const iCloudPath = sharedFoldersAvailable() ? sharedLocation().iCloudPath : null;
  if (iCloudPath && path.startsWith(`${iCloudPath}/`)) return ["iCloud Drive", ...path.slice(iCloudPath.length + 1).split("/")].join(" › ");
  return path;
}

export async function confirmRemovingShared(windowId: string, groupId: string): Promise<boolean> {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (!shared) return true;
  const g = store().groups[groupId];
  const name = (g && groupLabel(store(), g)) || "this folder";
  const { confirmed } = await confirm({
    title: `Remove “${name}” from the Sidebar?`,
    message: `The folder stays in ${folderLabel(shared.folder.path)}, with every link in it, and the people you shared it with keep it. Ardia only stops syncing it on this Mac.`,
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  return confirmed;
}
