import type { SearchScope } from "@ardia/core";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { expectFocus, heroBarFocus } from "../focus/focusClaims";
import { webviews } from "../../platform/webviews";

export type BarSnapshot = {
  typed: string;
  edited: boolean;
  selection: { start: number; end: number };
  selected: number;
  scope: SearchScope | null;
  scopeFrom: string;
};

const ntpQueries = new Map<string, BarSnapshot>();

export const savedNtpQuery = (tabId: string) => ntpQueries.get(tabId) ?? null;

export function saveNtpQuery(tabId: string, snapshot: BarSnapshot | null) {
  if (snapshot?.typed || snapshot?.scope) ntpQueries.set(tabId, snapshot);
  else ntpQueries.delete(tabId);
}

const heroBars = new Map<string, { tabId: string; focus: () => void }>();

export function registerHeroBar(windowId: string, tabId: string, focus: () => void): () => void {
  const bar = { tabId, focus };
  heroBars.set(windowId, bar);
  return () => {
    if (heroBars.get(windowId) === bar) heroBars.delete(windowId);
  };
}

export function focusHeroBar(windowId: string, tabId: string | undefined): boolean {
  const bar = heroBars.get(windowId);
  if (!bar || bar.tabId !== tabId) return false;
  expectFocus(windowId, heroBarFocus(tabId));
  bar.focus();
  return true;
}

export type BarDismissal = "escape" | "closeKey";

export function closePanelToHeroBar(windowId: string, tabId: string, reason?: BarDismissal) {
  useBrowser.getState().closePanel(windowId);
  const now = useBrowser.getState();
  if (activeTabId(now, windowId) !== tabId) return;
  if (!now.tabs[tabId]?.url) focusHeroBar(windowId, tabId);
  else if (reason && now.tabs[tabId]?.windowId === windowId) void webviews.get(tabId)?.focus();
}
