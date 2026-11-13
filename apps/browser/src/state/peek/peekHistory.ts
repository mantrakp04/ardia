import { useBrowser, type BrowserState } from "../browser/store";
import { pageOf, usePage } from "../tabs/pageState";
import { goBack, goForward } from "../tabs/navigation";
import { notePeekHistoryStep } from "../telemetry/usage";

export type PeekHistory = { back: boolean; forward: boolean };

export function peekHistoryOf(s: BrowserState, tabId: string): PeekHistory {
  const live = s.live[tabId];
  const page = pageOf(tabId);
  if (page.newTabShown) return { back: false, forward: true };
  return { back: !!live?.canGoBack || !!page.engineBack, forward: !!live?.canGoForward };
}

export function usePeekHistory(tabId: string): PeekHistory {
  const engineBack = usePage(tabId, (p) => !!p.engineBack);
  const shown = usePage(tabId, (p) => !!p.newTabShown);
  const back = useBrowser((s) => !!s.live[tabId]?.canGoBack);
  const forward = useBrowser((s) => !!s.live[tabId]?.canGoForward);
  return shown ? { back: false, forward: true } : { back: back || engineBack, forward };
}

export function stepPeekHistory(windowId: string, direction: -1 | 1): void {
  const s = useBrowser.getState();
  const tabId = s.peeks[windowId]?.tabId;
  if (!tabId) return;
  const history = peekHistoryOf(s, tabId);
  if (direction < 0 ? !history.back : !history.forward) return;
  notePeekHistoryStep(direction);
  if (direction < 0) goBack(tabId);
  else goForward(tabId);
}
