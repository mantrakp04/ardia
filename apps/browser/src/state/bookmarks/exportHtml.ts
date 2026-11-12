import { exportBookmarksHtml } from "../../platform/bookmarks";
import { revealFile } from "../../platform/files";
import { engineProfile, resolveWindowId } from "../browser/model";
import { useBrowser } from "../browser/store";
import { profileOfWindow } from "./bookmarkGroups";
import { showToast } from "../app/toasts";
import { PLATFORM_TERMS } from "../../lib/platformTerms";
import { noteBookmarkExport } from "../telemetry/exportCounts";

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export async function exportBookmarks(profileId: string): Promise<string | null> {
  const path = await exportBookmarksHtml(engineProfile(useBrowser.getState(), profileId));
  if (path) noteBookmarkExport();
  return path;
}

export async function exportBookmarksFromWindow(windowId: string | null | undefined) {
  const target = resolveWindowId(useBrowser.getState(), windowId) ?? null;
  try {
    const path = await exportBookmarks(profileOfWindow(target));
    if (path && target) showToast(target, "Bookmarks exported", fileName(path), { icon: "book", action: { title: `Show in ${PLATFORM_TERMS.fileManager}`, run: () => void revealFile(path) } });
  } catch (error) {
    if (target) showToast(target, "Couldn't export bookmarks", (error as Error).message);
    else console.warn("[bookmarks] export failed", error);
  }
}
