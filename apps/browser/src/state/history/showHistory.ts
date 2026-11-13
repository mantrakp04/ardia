import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { expectFocus, historySearchFocus } from "../focus/focusClaims";
import { openInternalPage } from "../pages/urls";

export const useHistorySearchFocusRequest = create<{ tabId: string | null }>()(() => ({ tabId: null }));

export const requestHistorySearchFocus = (tabId: string | null) => useHistorySearchFocusRequest.setState({ tabId });

export function showHistory(windowId: string) {
  openInternalPage("history", windowId);
  const history = activeTabId(useBrowser.getState(), windowId);
  if (!history) return;
  expectFocus(windowId, historySearchFocus(history));
  requestHistorySearchFocus(history);
}
