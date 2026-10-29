import type { StateCreator } from "zustand";
import type { Download } from "../../platform/downloads";
import type { BrowserWindow } from "../browser/types";
import type { BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile, privateSession } from "../browser/model";
import { focusedWindowOf, patchWindowUi } from "../windows/ui";

export type DownloadsSlice = {
  downloads: Download[];

  upsertDownload(d: Download): void;
  removeDownload(id: string): void;
  clearDownloads(windowId?: string): void;
  forgetDownloads(profile: string): void;
};

const MAX_DOWNLOADS = 100;

export function downloadSession(s: Pick<BrowserState, "profiles">, d: Pick<Download, "profile" | "offTheRecord">): string | null {
  if (d.offTheRecord) return d.profile ?? "";
  return d.profile && isIncognitoProfile(d.profile) ? privateSession(s, d.profile) : null;
}

export function downloadVisibleIn(s: Pick<BrowserState, "profiles">, d: Pick<Download, "profile" | "offTheRecord">, window: Pick<BrowserWindow, "kind" | "profileId"> | undefined): boolean {
  if (!window) return false;
  const session = downloadSession(s, d);
  if (window.kind === "private") return session !== null && session === privateSession(s, window.profileId);
  return session === null && (d.profile ?? "") === engineProfile(s, window.profileId);
}

const sessionOpen = (s: Pick<BrowserState, "windows" | "profiles">, session: string) =>
  Object.values(s.windows).some((w) => w.kind === "private" && privateSession(s, w.profileId) === session);
const endedPrivateDownloads = new Set<string>();

export const downloadsIn = (s: Pick<BrowserState, "downloads" | "windows" | "profiles">, windowId: string) =>
  s.downloads.filter((d) => downloadVisibleIn(s, d, s.windows[windowId]));

export const createDownloadsSlice: StateCreator<BrowserState, [], [], DownloadsSlice> = (set, get) => ({
  downloads: [],

  upsertDownload(d) {
    set((s) => {
      const exists = s.downloads.some((x) => x.id === d.id);
      if (!d.path && (d.state === "downloading" || d.state === "cancelled")) {
        return exists && d.state === "cancelled" ? { downloads: s.downloads.filter((x) => x.id !== d.id) } : {};
      }
      const session = downloadSession(s, d);
      if (!exists && session !== null && (!sessionOpen(s, session) || endedPrivateDownloads.has(d.id))) {
        endedPrivateDownloads.add(d.id);
        return {};
      }
      const downloads = exists ? s.downloads.map((x) => (x.id === d.id ? d : x)) : [d, ...s.downloads].slice(0, MAX_DOWNLOADS);
      const focused = focusedWindowOf(s);
      const open = !exists && focused && downloadVisibleIn(s, d, s.windows[focused]);
      return { downloads, ...(open ? patchWindowUi(s, focused, { downloadsOpen: true }) : {}) };
    });
  },

  removeDownload(id) {
    set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  },

  clearDownloads(windowId) {
    set((s) => ({
      downloads: s.downloads.filter((d) => d.state === "downloading" || (windowId !== undefined && !downloadVisibleIn(s, d, s.windows[windowId]))),
    }));
  },

  forgetDownloads(profile) {
    const session = privateSession(get(), profile);
    const gone = (d: Download) => (session !== null ? downloadSession(get(), d) === session : d.profile === profile);
    if (session !== null) for (const d of get().downloads) if (gone(d)) endedPrivateDownloads.add(d.id);
    set((s) => (s.downloads.some(gone) ? { downloads: s.downloads.filter((d) => !gone(d)) } : {}));
  },
});
