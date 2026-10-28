import { exportBookmarksHtml } from "../../platform/bookmarks";
import { revealFile } from "../../platform/files";
import { engineProfile, resolveWindowId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { profileOfWindow } from "./bookmarkGroups";

const fileName = (path: string) => path.split("/").pop() ?? path;

export const exportBookmarks = (profileId: string): Promise<string | null> => exportBookmarksHtml(engineProfile(profileId));

export async function exportBookmarksFromWindow(windowId: string | null | undefined) {
  const target = resolveWindowId(useBrowser.getState(), windowId) ?? null;
  const { showToast } = require("../splits/actions") as typeof import("../splits/actions");
  try {
    const path = await exportBookmarks(profileOfWindow(target));
    if (path && target) showToast(target, "Bookmarks exported", fileName(path), { icon: "book", action: { title: "Show in Finder", run: () => void revealFile(path) } });
  } catch (error) {
    if (target) showToast(target, "Couldn't export bookmarks", (error as Error).message);
    else console.warn("[bookmarks] export failed", error);
  }
}
