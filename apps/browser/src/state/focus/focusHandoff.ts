import { cancelFocusMove } from "../../platform/focus";
import type { CommandEvent } from "../../platform/commands";
import { useBrowser } from "../browser/store";
import { resolveWindowId } from "../browser/model";
import { peekTabId } from "../peek/peek";
import { cancelAbandonedFocus, claimFocusTag, commandBarFocus, expectFocus, findFocus, heroBarFocus, pageFocus, runFocusMove } from "./focusClaims";
import { webviews } from "../../platform/webviews";

const activeTab = (windowId: string) => {
  const w = useBrowser.getState().windows[windowId];
  return w ? w.activeTabIds[w.profileId] : undefined;
};

export function settlingCommandFocus(e: CommandEvent, run: (e: CommandEvent) => void) {
  const generation = e.focusGeneration;
  if (!generation) return run(e);
  const windowId = resolveWindowId(useBrowser.getState(), e.windowId);
  if (!windowId) {
    cancelFocusMove(generation, false);
    return run(e);
  }
  const before = activeTab(windowId);
  let expects = false;
  try {
    expects = runFocusMove(generation, windowId, before, () => {
      run(e);
      const after = activeTab(windowId);
      if (!after || after === before) return;
      if (!useBrowser.getState().tabs[after]?.url) return expectFocus(windowId, heroBarFocus(after));
      expectFocus(windowId, pageFocus(after));
      claimFocusTag(windowId, pageFocus(after), () => webviews.get(after)?.nativeTag() ?? null);
    });
  } finally {
    if (!expects) cancelFocusMove(generation, activeTab(windowId) === before);
  }
}

function stillPossible(windowId: string, destination: string): boolean {
  const s = useBrowser.getState();
  const active = activeTab(windowId);
  if (!active) return false;
  if (destination === commandBarFocus) return !!s.windowUi[windowId]?.panel.open;
  const peek = peekTabId(s, windowId);
  for (const page of peek ? [active, peek] : [active]) {
    if (destination === findFocus(page)) return !!s.find[page]?.open;
    if (destination === pageFocus(page)) return true;
  }
  return destination === heroBarFocus(active);
}

export function cancelAbandonedFocusMoves() {
  return useBrowser.subscribe(() => cancelAbandonedFocus(stillPossible, activeTab));
}
