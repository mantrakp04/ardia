import type { ActionState, ExtensionInstallPrompt, ExtensionPackage, InstalledExtension } from "../../platform/extensions";
import type { SettingsPane, SettingsPlace } from "../settings/settingsWindows";
import { useMemo } from "react";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, engineProfileForSpace, incognitoOriginal, isIncognitoSpace, privateSession } from "../browser/model";
import { shownPageId } from "../peek/peek";
import { isTabReady } from "../tabs/pageState";

export type { ActionState, InstalledExtension } from "../../platform/extensions";

export type Anchor = { x: number; y: number; width: number; height: number };

export const extensionPageUrl = (extensionId: string, path: string) => `chrome-extension://${extensionId}/${path.replace(/^\//, "")}`;

export type InstallRequest = { windowId: string; profile: string; source: "webStore" | "unpacked" } & (
  | { status: "error"; error: string }
  | { status: "ready" | "installing"; pkg: ExtensionPackage }
  | { status: "prompt"; prompt: ExtensionInstallPrompt }
);

type ExtensionsStore = {
  lists: Record<string, InstalledExtension[]>;
  actions: Record<string, Record<string, ActionState>>;
  popup: { windowId: string; pageSpace: string; extensionId: string; url: string; anchor: Anchor; opened?: number } | null;
  install: InstallRequest | null;
  pinDialog: { windowId: string } | null;
  sidePanels: Record<string, SidePanel>;
};

export type SidePanel = {
  extensionId: string;
  profile: string;
  pageSpace: string;
  url: string;
};

export const useExtensions = create<ExtensionsStore>()(() => ({ lists: {}, actions: {}, popup: null, install: null, pinDialog: null, sidePanels: {} }));

const EMPTY: InstalledExtension[] = [];

export function extensionSpace(s: BrowserState, windowId: string | null | undefined): string {
  const w = windowId ? s.windows[windowId] : undefined;
  return !w ? "" : (privateSession(s, w.spaceId) ?? engineProfileForSpace(w.spaceId));
}

export function settingsSpaceOf(s: BrowserState, windowId: string | null | undefined): string | null {
  const own = windowId ? s.windows[windowId]?.spaceId : undefined;
  if (!own) return null;
  const spaceId = isIncognitoSpace(own) ? incognitoOriginal(own) : own;
  return s.spaces[spaceId] ? spaceId : null;
}

export function extensionsSpaceId(spaceId?: string | null, windowId?: string | null): string {
  const s = useBrowser.getState();
  if (spaceId && s.spaces[spaceId]) return spaceId;
  const focused = s.ui.focusOrder.find((id) => !!s.windows[id]) ?? s.windowOrder.find((id) => !!s.windows[id]);
  return settingsSpaceOf(s, windowId) ?? settingsSpaceOf(s, focused) ?? s.settings.defaultSpaceId;
}

export function extensionsProfileId(spaceId?: string | null, windowId?: string | null): string {
  const s = useBrowser.getState();
  const window = windowId ? s.windows[windowId] : s.windows[s.ui.focusOrder[0] ?? ""];
  const engine = (window?.kind === "private") ? window.incognitoEngineId : engineProfileForSpace(extensionsSpaceId(spaceId, windowId));
  return Object.values(s.profiles).find((profile) => profile.engineId === engine)?.id ?? s.spaces[s.settings.defaultSpaceId]!.profileId;
}

export const settingsSpaceFor = (pane: string, current: { pane: string; spaceId: string | null }): string | null =>
  pane === "extensions" ? (current.pane === "extensions" && current.spaceId ? current.spaceId : extensionsProfileId()) : null;

export const isPrivate = (s: BrowserState, windowId: string) => s.windows[windowId]?.kind === "private";

export const pageSpace = (s: BrowserState, windowId: string) =>
  isPrivate(s, windowId) ? engineProfileForSpace(s.windows[windowId]!.spaceId) : extensionSpace(s, windowId);

const showsExtension = (priv: boolean, ext: InstalledExtension) => ext.enabled && (!priv || (ext.incognito && !!ext.incognitoSplit));

export function useWindowExtensions(windowId: string): InstalledExtension[] {
  const space = useBrowser((s) => extensionSpace(s, windowId));
  const priv = useBrowser((s) => isPrivate(s, windowId));
  const list = useExtensionList(space);
  return useMemo(() => list.filter((x) => showsExtension(priv, x)), [list, priv]);
}

export function windowExtensions(s: BrowserState, windowId: string | undefined): InstalledExtension[] {
  if (!windowId) return EMPTY;
  const priv = isPrivate(s, windowId);
  return (useExtensions.getState().lists[extensionSpace(s, windowId)] ?? EMPTY).filter((x) => showsExtension(priv, x));
}

export const shownIn = (windowId: string, extensionId: string) => windowExtensions(useBrowser.getState(), windowId).find((x) => x.id === extensionId);

export function useExtensionList(profile: string): InstalledExtension[] {
  return useExtensions((e) => e.lists[profile] ?? EMPTY);
}

export const readyTabOf = (tabId: string | undefined): string | undefined => (isTabReady(tabId) ? tabId : undefined);

export const shownReadyTab = (windowId: string) => readyTabOf(shownPageId(useBrowser.getState(), windowId));
