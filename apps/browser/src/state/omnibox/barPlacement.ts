import type { BrowserState } from "../browser/store";
import { activeTabId, tabsShownIn } from "../browser/model";
import { addressBarInSidebar } from "../windows/layout";
import { peekShown } from "../windows/dockMotion";
import { usePages } from "../tabs/pageState";

export type BarPlacement = "field" | "centred" | "centredNoField";

export function keyBarPlacement(o: { setting: "field" | "centred"; small: boolean; fieldShown: boolean }): BarPlacement {
  if (o.small) return "field";
  if (o.setting === "centred") return "centred";
  return o.fieldShown ? "field" : "centredNoField";
}

export function addressFieldShown(s: BrowserState, windowId: string): boolean {
  if (!s.windows[windowId]) return false;
  if (addressBarInSidebar(s, windowId)) return tabsShownIn(s, windowId) || peekShown(windowId);
  const tabId = activeTabId(s, windowId);
  return !!tabId && !!s.tabs[tabId]?.url && !usePages.getState().pages[tabId]?.fullscreen;
}

export const commandKeyPlacement = (s: BrowserState, windowId: string): BarPlacement =>
  keyBarPlacement({ setting: s.settings.commandBarPlacement, small: s.windows[windowId]?.kind === "small", fieldShown: addressFieldShown(s, windowId) });

export const isCentred = (placement: BarPlacement | undefined) => placement === "centred" || placement === "centredNoField";
