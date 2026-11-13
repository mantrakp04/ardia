import { useMemo } from "react";
import { useBrowser, type BrowserState } from "../../browser/src/state/browser/store";
import { extensionProfile, isPrivate, useExtensionList, useExtensions, type InstalledExtension } from "../../browser/src/state/extensions/store";

export * from "../../browser/src/state/extensions/store";

const EMPTY: InstalledExtension[] = [];

const showsExtension = (priv: boolean, ext: InstalledExtension) => ext.enabled && (!priv || ext.incognito === true);

export function useWindowExtensions(windowId: string): InstalledExtension[] {
  const profile = useBrowser((s) => extensionProfile(s, windowId));
  const priv = useBrowser((s) => isPrivate(s, windowId));
  const list = useExtensionList(profile);
  return useMemo(() => list.filter((x) => showsExtension(priv, x)), [list, priv]);
}

export function windowExtensions(s: BrowserState, windowId: string | undefined): InstalledExtension[] {
  if (!windowId) return EMPTY;
  const priv = isPrivate(s, windowId);
  return (useExtensions.getState().lists[extensionProfile(s, windowId)] ?? EMPTY).filter((x) => showsExtension(priv, x));
}

export const shownIn = (windowId: string, extensionId: string) => windowExtensions(useBrowser.getState(), windowId).find((x) => x.id === extensionId);
