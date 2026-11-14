import type { BrowserState } from "../browser/store";

export function keptTabsAdded(groups: BrowserState["groups"], prev: BrowserState["groups"]): number {
  const added = new Set<string>();
  for (const id in groups) {
    const shown = groups[id]!.shownTabIds;
    if (!shown || shown === prev[id]?.shownTabIds) continue;
    for (const tabId of shown) if (!prev[id]?.shownTabIds?.includes(tabId)) added.add(tabId);
  }
  return added.size;
}
