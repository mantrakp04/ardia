import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { viewTabIds } from "../browser/model";
import { folderNote } from "./engine";
import { isCalendarUrl } from "./meetings";
import { useLive } from "./store";

export const useCalendarTabIn = (windowId: string): string | undefined =>
  useBrowser((s) => viewTabIds(s, windowId).find((id) => s.tabs[id]?.pin && isCalendarUrl(s.tabs[id]!.pinnedUrl ?? s.tabs[id]!.url)));

export const useFolderNote = (folderId: string) => useLive(useShallow((s) => folderNote(s, folderId)));
