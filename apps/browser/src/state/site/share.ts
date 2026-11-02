import { cleanUrl } from "@ardia/core";
import { sharePage, sharePageVia, type ShareAnchor } from "../../platform/share";
import type { Tab } from "../browser/types";

export const canShare = (tab: Pick<Tab, "url"> | undefined) => /^https?:/i.test(tab?.url ?? "");

export async function shareTab(tab: Pick<Tab, "url" | "title" | "customTitle"> | undefined, windowId: string, via?: string | null, anchor?: ShareAnchor) {
  if (!tab || !canShare(tab)) return;
  const url = cleanUrl(tab.url);
  const title = tab.customTitle || tab.title || null;
  return via ? sharePageVia(via, url, title, windowId) : sharePage(url, title, windowId, anchor);
}
