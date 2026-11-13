import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { expectFocus, historySearchFocus } from "../focus/focusClaims";
import { openInternalPage } from "../pages/urls";
import { noteHistorySearchFocus } from "../telemetry/usage";

export const useHistorySearchFocusRequest = create<{ tabId: string | null }>()(() => ({ tabId: null }));

export function takeHistorySearchFocusRequest() {
  useHistorySearchFocusRequest.setState({ tabId: null });
  noteHistorySearchFocus("focused");
}

export function showHistory(windowId: string) {
  openInternalPage("history", windowId);
  const history = activeTabId(useBrowser.getState(), windowId);
  if (!history) return;
  expectFocus(windowId, historySearchFocus(history));
  useHistorySearchFocusRequest.setState({ tabId: history });
  noteHistorySearchFocus("requested");
}
