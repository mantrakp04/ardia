import type { BrowserState } from "../browser/store";
import { pinKeyOf } from "../browser/model";
import { revealGroupFolder, shareFolder, stopSyncingGroup } from "./actions";
import { canShareGroup, folderLabel, sharedFolderOfGroup } from "./removal";
import { folderRef, useSharedFolders, type SharedFolderSync } from "./store";

export function syncStatusText(sync: SharedFolderSync | undefined, path: string): string {
  if (!sync || sync.state === "syncing") return "Syncing…";
  if (sync.state === "waiting") return sync.waiting === 1 ? "Waiting for 1 link to download" : `Waiting for ${sync.waiting} links to download`;
  if (sync.state === "missing") return `Can’t find the folder in ${folderLabel(path.split("/").slice(0, -1).join("/"))}`;
  if (sync.state === "error") return `Can’t sync: ${sync.error ?? "unknown error"}`;
  if (sync.state === "paused") return "Syncs when this profile is open";
  return `Synced with ${folderLabel(path)}`;
}

export function sharedFolderMenuItems(s: Pick<BrowserState, "groups">, groupId: string) {
  if (!canShareGroup(s, groupId)) return [];
  const shared = sharedFolderOfGroup(s, groupId);
  if (!shared) return [{ id: "shareFolder", title: "Share Folder…", symbol: "person.crop.circle.badge.plus" }];
  const g = s.groups[groupId]!;
  const sync = useSharedFolders.getState().sync[folderRef(g.profileId, pinKeyOf(g))];
  return [
    { id: "sharedStatus", title: syncStatusText(sync, shared.folder.path), enabled: false },
    { id: "shareFolder", title: "Share Folder…", symbol: "person.crop.circle.badge.plus" },
    { id: "revealFolder", title: "Show in Finder", symbol: "folder" },
    { id: "stopSyncing", title: "Stop Syncing Folder", symbol: "icloud.slash" },
  ];
}

export function runSharedFolderChoice(windowId: string, groupId: string, choice: string): boolean {
  if (choice === "shareFolder") void shareFolder(windowId, groupId);
  else if (choice === "revealFolder") revealGroupFolder(groupId);
  else if (choice === "stopSyncing") stopSyncingGroup(groupId);
  else return false;
  return true;
}
