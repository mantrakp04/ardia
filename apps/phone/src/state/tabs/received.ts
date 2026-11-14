import { isSyncableUrl, type BrowserTab } from "./tabModels.ts";
import { openTab, type TabsChange, type TabsData } from "./tabsState.ts";

export type IncomingTab = { key: string; url: string; title: string; fromDevice: string; sentAt: number; profileSyncId: string | null };

export type HistoryCut = { profileSyncId: string | null; urls: readonly string[]; includesUnassigned: boolean };

export function receiveTabs(
  data: TabsData,
  incoming: readonly IncomingTab[],
  known: ReadonlySet<string>,
  now: number,
  newId: () => string,
): { change: TabsChange; opened: BrowserTab[] } {
  const held = new Set(known);
  for (const tab of [...data.open, ...(data.archive ?? [])]) if (tab.receivedKey) held.add(tab.receivedKey);
  let next = data;
  const put: BrowserTab[] = [];
  const opened: BrowserTab[] = [];
  for (const tab of [...incoming].sort((a, b) => a.sentAt - b.sentAt)) {
    if (held.has(tab.key) || !isSyncableUrl(tab.url)) continue;
    held.add(tab.key);
    const made = openTab(
      next,
      {
        url: tab.url,
        title: tab.title,
        origin: "sent",
        isPrivate: false,
        selecting: false,
        profileSyncId: tab.profileSyncId,
        received: { key: tab.key, fromDevice: tab.fromDevice },
      },
      now,
      newId(),
    );
    next = made.change.data;
    put.push(...made.change.put);
    opened.push(made.tab);
  }
  const unique = [...new Map(put.map((tab) => [tab.id, tab])).values()];
  return { change: { data: next, put: unique, remove: [], endedPages: [] }, opened };
}

export function historyCuts(removal: HistoryCut): { urls: readonly string[]; profileSyncId: string | null }[] {
  const cuts = [{ urls: removal.urls, profileSyncId: removal.profileSyncId }];
  if (removal.includesUnassigned && removal.profileSyncId !== null) cuts.push({ urls: removal.urls, profileSyncId: null });
  return cuts;
}
