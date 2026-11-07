import { cleanUrl } from "@ardia/core";
import { sharePage, sharePageVia, shareText, type PageShare, type ShareAnchor } from "../../platform/share";
import type { Tab } from "../browser/types";

export const canShare = (tab: Pick<Tab, "url"> | undefined) => /^https?:/i.test(tab?.url ?? "");

export async function shareTab(tab: Pick<Tab, "url" | "title" | "customTitle"> | undefined, windowId: string, via?: string | null, anchor?: ShareAnchor) {
  if (!tab || !canShare(tab)) return;
  const url = cleanUrl(tab.url);
  const title = tab.customTitle || tab.title || null;
  return via ? sharePageVia(via, url, title, windowId) : sharePage(url, title, windowId, anchor);
}

const webUrl = (url: string | undefined) => (url && /^https?:/i.test(url) ? url : null);

export function shareFromPage(tab: Pick<Tab, "url" | "title" | "customTitle" | "windowId"> | undefined, share: PageShare, anchor?: ShareAnchor) {
  if (!tab) return;
  if (share.kind === "page") return shareTab(tab, tab.windowId, null, anchor);
  if (share.kind === "text") return share.text ? shareText(share.text, tab.windowId, anchor) : undefined;
  const url = (share.kind === "image" && share.fileUrl) || webUrl(share.url);
  if (!url) return;
  return sharePage(url === share.fileUrl ? url : cleanUrl(url), share.title || null, tab.windowId, anchor);
}
