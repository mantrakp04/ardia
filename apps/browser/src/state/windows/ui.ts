import type { Download } from "../../platform/downloads";
import type { StateCreator } from "zustand";
import type { BrowserState } from "../browser/store";
import { engineProfile, isIncognitoProfile, privateSession } from "../browser/model";
import { linkProfileOf } from "./small";
import type { FindState, NewTabTarget, WindowUi } from "../browser/types";
import { commandBarFocus, expectFocus } from "../focus/focusClaims";

export type UiSlice = {
  ui: {
    focusedWindowId: string | null;
    focusOrder: string[];
    appDark: boolean;
    lastProfileId: string | null;
  };
  windowUi: Record<string, WindowUi>;
  find: Record<string, FindState>;
  downloads: Download[];

  setFocusedWindow(id: string): void;
  setAppDark(dark: boolean): void;
  openPanel(windowId: string, initialText?: string, newTab?: NewTabTarget): void;
  closePanel(windowId: string): void;
  setDownloadsOpen(windowId: string, open: boolean): void;
  setFind(tabId: string, patch: Partial<FindState>): void;
  upsertDownload(d: Download): void;
  removeDownload(id: string): void;
  clearDownloads(windowId?: string): void;
  forgetDownloads(profile: string): void;
};

export function downloadSession(d: Pick<Download, "profile" | "offTheRecord">): string | null {
  if (d.offTheRecord) return d.profile ?? "";
  return d.profile && isIncognitoProfile(d.profile) ? privateSession(d.profile) : null;
}

export function downloadVisibleIn(d: Pick<Download, "profile" | "offTheRecord">, window: { incognito: boolean; profileId: string } | undefined): boolean {
  if (!window) return false;
  const session = downloadSession(d);
  if (window.incognito) return session !== null && session === privateSession(window.profileId);
  return session === null && (d.profile ?? "") === engineProfile(window.profileId);
}

const sessionOpen = (s: Pick<BrowserState, "windows">, session: string) =>
  Object.values(s.windows).some((w) => w.incognito && privateSession(w.profileId) === session);
const endedPrivateDownloads = new Set<string>();

export const downloadsIn = (s: Pick<BrowserState, "downloads" | "windows">, windowId: string) =>
  s.downloads.filter((d) => downloadVisibleIn(d, s.windows[windowId]));

export const DEFAULT_WINDOW_UI: WindowUi = { panel: { open: false, initialText: "" }, downloadsOpen: false };
export const CLOSED_FIND: FindState = { open: false, query: "", count: null, active: 0 };
const MAX_DOWNLOADS = 100;

function patchWindowUi(s: BrowserState, windowId: string, patch: Partial<WindowUi>): Partial<BrowserState> {
  if (!s.windows[windowId]) return {};
  return { windowUi: { ...s.windowUi, [windowId]: { ...(s.windowUi[windowId] ?? DEFAULT_WINDOW_UI), ...patch } } };
}

export const createUiSlice: StateCreator<BrowserState, [], [], UiSlice> = (set, get) => ({
  ui: { focusedWindowId: null, focusOrder: [], appDark: true, lastProfileId: null },
  windowUi: {},
  find: {},
  downloads: [],

  setFocusedWindow(id) {
    const s = get();
    const { ui, windows } = s;
    if (!windows[id]) return;
    const lastProfileId = linkProfileOf(s, windows[id]) ?? ui.lastProfileId;
    if (ui.focusedWindowId === id && ui.lastProfileId === lastProfileId) return;
    set({ ui: { ...ui, focusedWindowId: id, focusOrder: [id, ...ui.focusOrder.filter((w) => w !== id)], lastProfileId } });
  },

  setAppDark(appDark) {
    if (get().ui.appDark !== appDark) set((s) => ({ ui: { ...s.ui, appDark } }));
  },

  openPanel(windowId, initialText = "", newTab) {
    expectFocus(windowId, commandBarFocus);
    set((s) => patchWindowUi(s, windowId, { panel: newTab ? { open: true, initialText, newTab } : { open: true, initialText } }));
  },

  closePanel(windowId) {
    set((s) => patchWindowUi(s, windowId, { panel: { open: false, initialText: "" } }));
  },

  setDownloadsOpen(windowId, downloadsOpen) {
    set((s) => patchWindowUi(s, windowId, { downloadsOpen }));
  },

  setFind(tabId, patch) {
    set((s) => (s.tabs[tabId] ? { find: { ...s.find, [tabId]: { ...(s.find[tabId] ?? CLOSED_FIND), ...patch } } } : {}));
  },

  upsertDownload(d) {
    set((s) => {
      const exists = s.downloads.some((x) => x.id === d.id);
      const session = downloadSession(d);
      if (!exists && session !== null && (!sessionOpen(s, session) || endedPrivateDownloads.has(d.id))) {
        endedPrivateDownloads.add(d.id);
        return {};
      }
      const downloads = exists ? s.downloads.map((x) => (x.id === d.id ? d : x)) : [d, ...s.downloads].slice(0, MAX_DOWNLOADS);
      const focused = s.ui.focusedWindowId;
      const open = !exists && focused && downloadVisibleIn(d, s.windows[focused]);
      return { downloads, ...(open ? patchWindowUi(s, focused, { downloadsOpen: true }) : {}) };
    });
  },

  removeDownload(id) {
    set((s) => ({ downloads: s.downloads.filter((d) => d.id !== id) }));
  },

  clearDownloads(windowId) {
    set((s) => ({
      downloads: s.downloads.filter((d) => d.state === "downloading" || (windowId !== undefined && !downloadVisibleIn(d, s.windows[windowId]))),
    }));
  },

  forgetDownloads(profile) {
    const session = privateSession(profile);
    const gone = (d: Download) => (session !== null ? downloadSession(d) === session : d.profile === profile);
    if (session !== null) for (const d of get().downloads) if (gone(d)) endedPrivateDownloads.add(d.id);
    set((s) => (s.downloads.some(gone) ? { downloads: s.downloads.filter((d) => !gone(d)) } : {}));
  },
});
