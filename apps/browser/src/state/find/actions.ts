import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { setFind } from "../windows/actions";

export function openFind(tabId: string, options: { replace?: boolean; query?: string } = {}) {
  setFind(tabId, { open: true, ...options, focusRequest: Date.now() });
}

export function closeFind(tabId: string) {
  setFind(tabId, { open: false, count: null, active: 0 });
  void webviews.get(tabId)?.stopFinding(false);
  void webviews.get(tabId)?.focus();
}

export function findStep(tabId: string, backwards: boolean) {
  const query = useBrowser.getState().find[tabId]?.query;
  if (!query) return setFind(tabId, { open: true });
  void webviews.get(tabId)?.find(query, !backwards, true);
}

export const takeFindFocusRequest = (tabId: string) => setFind(tabId, { focusRequest: undefined });
