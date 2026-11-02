import { useBrowser } from "../browser/store";
import { pinKeyOf } from "../browser/model";
import { folderRef, useSharedFolders } from "./store";

export type SharedFolderMark = "shared" | "waiting" | "error";

export function useSharedFolderMark(groupId: string): SharedFolderMark | null {
  const ref = useBrowser((s) => {
    const g = s.groups[groupId];
    return g?.pinned && !g.parentId ? folderRef(g.profileId, pinKeyOf(g)) : null;
  });
  return useSharedFolders((s) => {
    if (!ref) return null;
    const [profileId, key] = ref.split("\u0001") as [string, string];
    if (!s.folders[profileId]?.[key]) return null;
    const state = s.sync[ref]?.state;
    return state === "error" || state === "missing" ? "error" : state === "waiting" ? "waiting" : "shared";
  });
}
