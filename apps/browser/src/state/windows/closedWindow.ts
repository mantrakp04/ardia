import type { BrowserState } from "../browser/store";
import { inPinnedContainer, pinKeyOf, snapshotTab } from "../browser/model";
import { closedWindowEntry } from "../pins/closedTabs";
import { pendingRestore } from "../tabs/adoptIds";
import { hasLoadedPage } from "../tabs/pageSession";
import { sharesTabs } from "../tabs/tabShare";
import { mapSlotIds, splitTabIds } from "../splits/splits";
import type { BrowserWindow, ClosedWindow, Tab } from "../browser/types";

export function closedWindowOf(s: BrowserState, w: BrowserWindow, tabs: Tab[], keepsLastWindow: boolean): ClosedWindow {
  const tabIds = tabs.map((t) => t.id);
  const active = new Set(Object.values(w.activeTabIds));
  const entry = closedWindowEntry(
    w,
    tabs.map((t) => ({ ...snapshotTab(t), active: active.has(t.id), ...(hasLoadedPage(t) ? { tabId: t.id } : pendingRestore(t) ? { tabId: pendingRestore(t) } : {}) })),
    Object.values(s.groups)
      .filter((g) => g.windowId === w.id && !g.pinned && (!sharesTabs(s) || g.tabIds.some((t) => tabIds.includes(t))))
      .map(({ tabIds: members, windowId: _, shownTabIds: __, ...g }) => ({ ...g, tabIndexes: members.map((t) => tabIds.indexOf(t)) })),
    Date.now(),
  );
  const splits = Object.values(s.splits)
    .filter((v) => v.windowId === w.id && splitTabIds(v).every((t) => tabIds.includes(t)))
    .map((v) => ({ orientation: v.orientation, slots: mapSlotIds(v.slots, (t) => String(tabIds.indexOf(t))) }));
  const shown = w.activeTabIds[w.profileId];
  const activePin = keepsLastWindow && shown && s.tabs[shown] && inPinnedContainer(s, shown) ? pinKeyOf(s.tabs[shown]!) : undefined;
  return {
    ...entry,
    ...(splits.length ? { splits } : {}),
    ...(keepsLastWindow ? { lastWindow: true as const } : {}),
    ...(activePin ? { activePin } : {}),
  };
}

export function withoutLastWindowMarks(list: ClosedWindow[]): ClosedWindow[] {
  if (!list.some((c) => c.lastWindow)) return list;
  return list.flatMap(({ lastWindow, activePin: _, ...rest }) => (!lastWindow ? [rest] : rest.tabs.length ? [rest] : []));
}
