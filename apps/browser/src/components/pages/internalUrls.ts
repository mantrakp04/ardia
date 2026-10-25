import { appScheme, isAppScheme } from "@ardia/core";

export type InternalPageId = "history" | "bookmarks" | "downloads";

export const INTERNAL_PAGES: Record<InternalPageId, { title: string }> = {
  history: { title: "History" },
  bookmarks: { title: "Bookmarks" },
  downloads: { title: "Downloads" },
};

export const internalUrl = (page: InternalPageId, query?: string) => `${appScheme()}://${page}${query ? `?q=${encodeURIComponent(query)}` : ""}`;

export function internalPageOf(url: string | null | undefined): InternalPageId | null {
  const m = url ? /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url) : null;
  if (!m || !isAppScheme(m[1]!)) return null;
  const page = m[2]!.toLowerCase();
  return page in INTERNAL_PAGES ? (page as InternalPageId) : null;
}

export function internalQuery(url: string): string {
  const q = /[?&]q=([^&#]*)/.exec(url)?.[1];
  try {
    return q ? decodeURIComponent(q) : "";
  } catch {
    return q ?? "";
  }
}
