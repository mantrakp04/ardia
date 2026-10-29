import { exportBookmarksHtml } from "../../platform/bookmarks";
import { revealFile } from "../../platform/files";
import { engineProfile, engineProfileForSpace, resolveWindowId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { spaceOfWindow } from "./bookmarkGroups";
import { showToast } from "../app/toasts";

const fileName = (path: string) => path.split("/").pop() ?? path;

export const exportBookmarks = (spaceId: string): Promise<string | null> => exportBookmarksHtml(engineProfile(useBrowser.getState(), spaceId));

export async function exportBookmarksFromWindow(windowId: string | null | undefined) {
  const target = resolveWindowId(useBrowser.getState(), windowId) ?? null;
  try {
    const path = await exportBookmarks(spaceOfWindow(target));
    if (path && target) showToast(target, "Bookmarks exported", fileName(path), { icon: "book", action: { title: "Show in Finder", run: () => void revealFile(path) } });
  } catch (error) {
    if (target) showToast(target, "Couldn't export bookmarks", (error as Error).message);
    else console.warn("[bookmarks] export failed", error);
  }
}
