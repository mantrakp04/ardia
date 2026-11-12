import { useEffect } from "react";
import { showOnceOverEmptyCard } from "../../state/omnibox/newTabBar";

export function EmptyCard({ windowId, tabId }: { windowId: string; tabId: string }) {
  useEffect(() => showOnceOverEmptyCard(windowId, tabId), [windowId, tabId]);
  return null;
}
