import { useBrowser } from "../browser/store";
import { viewTabIds } from "../browser/model";
import { isCalendarUrl } from "./meetings";

export const useCalendarTabIn = (windowId: string): string | undefined =>
  useBrowser((s) => viewTabIds(s, windowId).find((id) => s.tabs[id]?.pin && isCalendarUrl(s.tabs[id]!.pinnedUrl ?? s.tabs[id]!.url)));
