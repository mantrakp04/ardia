import { create } from "zustand";
import { tabLayoutOf } from "../browser/model";
import { switchOn } from "../../platform/killSwitches";
import { ARC_LIGHTS_CENTER, lightsCenter, toolbarLightsCenter, TOP_STRIP_LIGHTS_CENTER } from "./dockMotion";
import { DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { useBrowser, type BrowserState } from "../browser/store";
import { useWindowId } from "../browser/hooks";

export function useTabLayout(): "sidebar" | "top" {
  const windowId = useWindowId();
  return useBrowser((s) => tabLayoutOf(s, windowId));
}

export function addressBarInSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return (
    !!w &&
    s.settings.addressBar === "sidebar" &&
    (w.sidebarOpen || switchOn("sidebarSlide")) &&
    tabLayoutOf(s, w.id) === "sidebar"
  );
}

export function commandBarCentred(s: BrowserState, windowId: string): boolean {
  return s.settings.commandBarPlacement === "centred" && !!s.windows[windowId] && s.windows[windowId]!.kind !== "small";
}

export function useAddressBarInSidebar(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => addressBarInSidebar(s, windowId));
}

export function openingLightsCenter(s: BrowserState, windowId: string): [number, number] | null {
  const w = s.windows[windowId];
  if (!w) return null;
  const open = w.sidebarOpen ?? true;
  if (tabLayoutOf(s, w.id) === "top") return open ? [...TOP_STRIP_LIGHTS_CENTER] : lightsCenter(DEFAULT_SIDEBAR_WIDTH);
  return lightsCenter(open ? 0 : s.settings.sidebarWidth, 0, s.settings.addressBar === "sidebar" ? ARC_LIGHTS_CENTER : toolbarLightsCenter(s.settings.compactToolbar));
}

export const useToolbarLightsCenter = (): readonly [number, number] => toolbarLightsCenter(useBrowser((s) => s.settings.compactToolbar));

type UrlAnchor = { left: number; top: number; width: number; sidebar?: { height: number } };

export const useUrlAnchors = create<Record<string, UrlAnchor>>()(() => ({}));

export function setUrlAnchor(windowId: string, anchor: UrlAnchor) {
  const current = useUrlAnchors.getState()[windowId];
  if (current && current.left === anchor.left && current.top === anchor.top && current.width === anchor.width && current.sidebar?.height === anchor.sidebar?.height) return;
  useUrlAnchors.setState({ [windowId]: anchor });
}

type CardAnchor = { left: number; top: number; width: number; height: number };

export const useCardAnchors = create<Record<string, CardAnchor>>()(() => ({}));

export function setCardAnchor(windowId: string, anchor: CardAnchor) {
  const current = useCardAnchors.getState()[windowId];
  if (current && current.left === anchor.left && current.top === anchor.top && current.width === anchor.width && current.height === anchor.height) return;
  useCardAnchors.setState({ [windowId]: anchor });
}

export const useToolbarExtensionsWidths = create<Record<string, number>>()(() => ({}));

export function watchToolbarExtensionsWidth(windowId: string, listener: (width: number | undefined) => void): () => void {
  listener(useToolbarExtensionsWidths.getState()[windowId]);
  return useToolbarExtensionsWidths.subscribe((w, prev) => {
    if (w[windowId] !== prev[windowId]) listener(w[windowId]);
  });
}

export function setToolbarExtensionsWidth(windowId: string, width: number) {
  if (useToolbarExtensionsWidths.getState()[windowId] === width) return;
  useToolbarExtensionsWidths.setState({ [windowId]: width });
}
