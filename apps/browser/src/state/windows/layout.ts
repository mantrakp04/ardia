import { create } from "zustand";
import { sidebarSideOf, tabLayoutOf, tabsShownIn } from "../browser/model";
import { switchOn } from "../../platform/killSwitches";
import { ARC_LIGHTS_CENTER, lightsCenter, sidebarLightsCenter, toolbarLightsCenter, TOP_STRIP_LIGHTS_CENTER } from "./dockMotion";
import type { LightsPlace } from "../../platform/windows";
import { DEFAULT_SIDEBAR_WIDTH } from "../../lib/windowLayout";
import { useBrowser, type BrowserState } from "../browser/store";
import { useWindowId } from "../browser/hooks";
import { useSettingValue } from "../tabs/tabWatch";
import { BROWSER_WINDOW_BUTTONS, captionClearTop, captionRoom, WINDOW_CHROME, WINDOW_CONTROLS, windowControlsWidth, type WindowChrome } from "../../lib/windowChrome";
import { toolbarRowOf } from "../../lib/toolbarRow";
import { SMALL_BAR_HEIGHT } from "./small";
import type { CaptionRegion } from "../../platform/windowControls";

export { windowCornerRadius } from "../../platform/windows";

export function useTabLayout(): "sidebar" | "top" {
  const windowId = useWindowId();
  return useBrowser((s) => tabLayoutOf(s, windowId));
}

export function addressBarInSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return (
    !!w &&
    s.settings.addressBar === "sidebar" &&
    (tabsShownIn(s, windowId) || switchOn("sidebarSlide")) &&
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
  const open = tabsShownIn(s, windowId);
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
  return tabLayoutOf(s, windowId) === "top" || sidebarSideOf(s, windowId) !== "right" || !tabsShownIn(s, windowId);
}

export function cardCaptionRoom(s: BrowserState, windowId: string, frame: number, chrome: WindowChrome = WINDOW_CHROME): number {
  if (!cardReachesCaption(s, windowId, chrome)) return 0;
  const strip = tabLayoutOf(s, windowId) === "top" && tabsShownIn(s, windowId);
  return strip ? 0 : captionRoom(frame, 0, chrome);
}

export function cardTopInset(s: BrowserState, windowId: string, frame: number, chrome: WindowChrome = WINDOW_CHROME): number {
  if (!cardReachesCaption(s, windowId, chrome) || tabLayoutOf(s, windowId) === "top") return frame;
  const toolbar = addressBarInSidebar(s, windowId) ? 0 : toolbarRowOf(s.settings.compactToolbar).height;
  return captionClearTop(frame, toolbar, frame, chrome);
}

export function sidebarCaptionRoom(s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): number {
  const w = s.windows[windowId];
  if (!chrome.trailingWidth || !w || w.fullScreen || sidebarSideOf(s, windowId) !== "right") return 0;
  return captionRoom(0, 0, chrome);
}

export type WindowControlsHost = "toolbar" | "sidebar" | "strip" | "band";
export type WindowControlsPlace = { centerY: number; size: number; host: WindowControlsHost };

export function windowControlsPlace(s: BrowserState, windowId: string, frame: number, chrome: WindowChrome = WINDOW_CHROME): WindowControlsPlace | null {
  const w = s.windows[windowId];
  if (!chrome.trailingWidth || !w || w.fullScreen) return null;
  if (w.kind === "small") return { centerY: Math.max(SMALL_BAR_HEIGHT, chrome.titleBarHeight) / 2, size: WINDOW_CONTROLS.small, host: "strip" };
  const top = tabLayoutOf(s, windowId) === "top";
  if (top && tabsShownIn(s, windowId)) return { centerY: TOP_STRIP_LIGHTS_CENTER[1], size: WINDOW_CONTROLS.regular, host: "strip" };
  const inSidebar = !top && sidebarSideOf(s, windowId) === "right" && tabsShownIn(s, windowId);
  if (addressBarInSidebar(s, windowId)) {
    if (inSidebar) return { centerY: ARC_LIGHTS_CENTER[1], size: WINDOW_CONTROLS.regular, host: "sidebar" };
    return { centerY: chrome.titleBarHeight / 2, size: WINDOW_CONTROLS.band, host: "band" };
  }
  if (inSidebar) return { centerY: toolbarLightsCenter(s.settings.compactToolbar, frame)[1], size: WINDOW_CONTROLS.regular, host: "sidebar" };
  const row = toolbarRowOf(s.settings.compactToolbar);
  return { centerY: frame + row.center, size: row.button, host: "toolbar" };
}

export const windowControlsBottom = (place: WindowControlsPlace | null): number => (place ? place.centerY + place.size / 2 : 0);

const CAPTION_GUTTER_MIN = 3;
const SIDEBAR_TOOLS_TOP = 7;

export function captionRegions(s: BrowserState, windowId: string, overlaid = false, chrome: WindowChrome = WINDOW_CHROME): CaptionRegion[] {
  const frame = s.settings.pageFrame;
  const place = windowControlsPlace(s, windowId, frame, chrome);
  if (!place || overlaid) return [];
  const ui = s.windowUi[windowId];
  if (ui?.panel.open || ui?.downloadsOpen) return [];
  const controls = windowControlsWidth(BROWSER_WINDOW_BUTTONS) + WINDOW_CONTROLS.edge;
  const regions: CaptionRegion[] = [[-(chrome.trailingWidth - 2), 0, controls + WINDOW_CONTROLS.gap, windowControlsBottom(place)]];
  if (place.host === "strip") return regions;
  const gutter = Math.min(frame, place.centerY - place.size / 2 - 1, addressBarInSidebar(s, windowId) ? SIDEBAR_TOOLS_TOP : frame);
  if (gutter >= CAPTION_GUTTER_MIN) regions.push([0, 0, 0, gutter]);
  return regions;
}

export function sidebarHeaderCollapsed(s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): boolean {
  const w = s.windows[windowId];
  if (chrome.leadingWidth || !chrome.trailingWidth || !w) return false;
  if (tabLayoutOf(s, windowId) !== "sidebar" || addressBarInSidebar(s, windowId) || sidebarSideOf(s, windowId) === "right") return false;
  return w.kind !== "private" && s.profileOrder.length < 2;
}

export const COLLAPSED_SIDEBAR_HEADER_MIN = 6;

export const collapsedSidebarHeader = (frame: number) => Math.max(frame, COLLAPSED_SIDEBAR_HEADER_MIN);

export const downloadsInSidebarFooter = (s: BrowserState, windowId: string, chrome: WindowChrome = WINDOW_CHROME): boolean =>
  addressBarInSidebar(s, windowId) || sidebarHeaderCollapsed(s, windowId, chrome);

export function useSidebarCaptionRoom(): number {
  const windowId = useWindowId();
  return useBrowser((s) => sidebarCaptionRoom(s, windowId));
}

export function useCardCaptionRoom(frame: number): number {
  const windowId = useWindowId();
  return useBrowser((s) => cardCaptionRoom(s, windowId, frame));
}

export function useCardTopInset(frame: number): number {
  const windowId = useWindowId();
  return useBrowser((s) => cardTopInset(s, windowId, frame));
}

export function useSidebarHeaderCollapsed(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => sidebarHeaderCollapsed(s, windowId));
}

export function useDownloadsInSidebarFooter(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => downloadsInSidebarFooter(s, windowId));
}

export function useWindowControlsCenterY(): number | null {
  const windowId = useWindowId();
  return useBrowser((s) => windowControlsPlace(s, windowId, s.settings.pageFrame)?.centerY ?? null);
}

export function useWindowControlsSize(): number {
  const windowId = useWindowId();
  return useBrowser((s) => windowControlsPlace(s, windowId, s.settings.pageFrame)?.size ?? 0);
}

export function useWindowControlsBottom(): number {
  const windowId = useWindowId();
  return useBrowser((s) => windowControlsBottom(windowControlsPlace(s, windowId, s.settings.pageFrame)));
}

export function useWindowControlsHost(): WindowControlsHost | null {
  const windowId = useWindowId();
  return useBrowser((s) => windowControlsPlace(s, windowId, s.settings.pageFrame)?.host ?? null);
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
