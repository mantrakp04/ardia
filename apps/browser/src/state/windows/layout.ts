import { create } from "zustand";
import { sidebarSideOf, tabLayoutOf } from "../browser/model";
import { switchOn } from "../../platform/killSwitches";
import { ARC_LIGHTS_CENTER, lightsCenter, sidebarLightsCenter, toolbarLightsCenter, TOP_STRIP_LIGHTS_CENTER } from "./dockMotion";
import type { LightsPlace } from "../../platform/windows";
import { DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { useBrowser, type BrowserState } from "../browser/store";
import { useWindowId } from "../browser/hooks";
import { useSettingValue } from "../tabs/tabWatch";
import { captionClearTop, captionRoom, WINDOW_CHROME, type WindowChrome } from "../../lib/windowChrome";
import { toolbarRowOf } from "../../lib/toolbarRow";

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

export function openingLightsCenter(s: BrowserState, windowId: string): LightsPlace | null {
  const w = s.windows[windowId];
  if (!w) return null;
  const open = w.sidebarOpen ?? true;
  if (tabLayoutOf(s, w.id) === "top") return open ? [...TOP_STRIP_LIGHTS_CENTER] : lightsCenter(DEFAULT_SIDEBAR_WIDTH);
  const width = s.settings.sidebarWidth;
  const base = s.settings.addressBar === "sidebar" ? ARC_LIGHTS_CENTER : toolbarLightsCenter(s.settings.compactToolbar, s.settings.pageFrame);
  return sidebarLightsCenter(sidebarSideOf(s, w.id) === "right", width, open ? 0 : width, 0, base);
}

const pageFrameSetting = (settings: BrowserState["settings"]) => settings.pageFrame;

export const usePageFrameInset = (): number => useSettingValue(pageFrameSetting);

function cardReachesCaption(s: BrowserState, windowId: string, chrome: WindowChrome): boolean {
  const w = s.windows[windowId];
  if (!chrome.trailingWidth || !w || w.fullScreen || w.kind === "small") return false;
  return tabLayoutOf(s, windowId) === "top" || sidebarSideOf(s, windowId) !== "right" || w.sidebarOpen === false;
}

export function cardCaptionRoom(s: BrowserState, windowId: string, frame: number, stripHeight: number, chrome: WindowChrome = WINDOW_CHROME): number {
  if (!cardReachesCaption(s, windowId, chrome)) return 0;
  const strip = tabLayoutOf(s, windowId) === "top" && s.windows[windowId]!.sidebarOpen !== false;
  return captionRoom(frame, strip ? stripHeight : frame, chrome);
}

export function cardTopInset(s: BrowserState, windowId: string, frame: number, chrome: WindowChrome = WINDOW_CHROME): number {
  if (!cardReachesCaption(s, windowId, chrome) || tabLayoutOf(s, windowId) === "top") return frame;
  const toolbar = addressBarInSidebar(s, windowId) || s.settings.hideToolbarWhileScrolling ? 0 : toolbarRowOf(s.settings.compactToolbar).height;
  return captionClearTop(frame, toolbar, frame, chrome);
}

export function sidebarCaptionRoom(s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): number {
  const w = s.windows[windowId];
  if (!chrome.trailingWidth || !w || w.fullScreen || sidebarSideOf(s, windowId) !== "right") return 0;
  return captionRoom(0, 0, chrome);
}

export function useSidebarCaptionRoom(): number {
  const windowId = useWindowId();
  return useBrowser((s) => sidebarCaptionRoom(s, windowId));
}

export function useCardCaptionRoom(frame: number, stripHeight: number): number {
  const windowId = useWindowId();
  return useBrowser((s) => cardCaptionRoom(s, windowId, frame, stripHeight));
}

export function useCardTopInset(frame: number): number {
  const windowId = useWindowId();
  return useBrowser((s) => cardTopInset(s, windowId, frame));
}

export const useToolbarLightsCenter = (): readonly [number, number] => toolbarLightsCenter(useBrowser((s) => s.settings.compactToolbar), usePageFrameInset());

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
