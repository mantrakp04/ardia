import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTab, pinnedSectionTitle } from "../../store/model";
import { groupOf, selectedTabIds } from "../../store/organize";
import { pinKeyOf } from "../../store/pinMirror";
import type { Tab } from "../../store/types";

type ListSpot = { windowId: string; key: string; list: string[]; index: number; order: number; groupId: string | null };

const listSpots = new Map<string, ListSpot>();
let spotOrder = 0;
const store = () => useBrowser.getState();

export const movePinnedTitle = (s: BrowserState, tab: Tab | undefined) => (tab?.pinned ? "Move out of Pinned" : `Move to ${pinnedSectionTitle(s, tab)}`);

const listTabIds = (s: BrowserState, windowId: string, profileId: string, except: Set<string>) =>
  (s.windows[windowId]?.tabIds ?? []).filter((id) => {
    const t = s.tabs[id];
    return t && !t.pinned && t.profileId === profileId && !except.has(id) && !groupOf(s, id)?.pinned;
  });

export function togglePinnedRows(windowId: string) {
  const s = store();
  const tab = activeTab(s, windowId);
  if (!tab) return;
  const selected = selectedTabIds(s, windowId).map((id) => s.tabs[id]!).filter((t) => t.profileId === tab.profileId);
  if (!tab.pinned) return moveToPinnedRows(s, windowId, selected.filter((t) => !t.pinned));
  moveOutOfPinned(selected.filter((t) => t.pinned));
}

function moveToPinnedRows(s: BrowserState, windowId: string, tabs: Tab[]) {
  if (!tabs.length) return;
  const moving = new Set(tabs.map((t) => t.id));
  const list = listTabIds(s, windowId, tabs[0]!.profileId, new Set()).map((id) => pinKeyOf(s.tabs[id]!));
  for (const t of tabs) {
    const group = groupOf(s, t.id);
    const key = pinKeyOf(t);
    listSpots.set(key, { windowId, key, list, index: list.indexOf(key), order: spotOrder++, groupId: group && !group.pinned ? group.id : null });
  }
  s.pinTabs([...moving], true, true);
}

type Restore = ListSpot & { tabId: string };

const precedes = (a: Restore, b: Restore) =>
  [a.list, b.list].some((list) => {
    const i = list.indexOf(a.key);
    const j = list.indexOf(b.key);
    return i >= 0 && j >= 0 && i < j;
  });

function inListOrder(spots: Restore[]): Restore[] {
  const left = [...spots].sort((x, y) => x.index - y.index || x.order - y.order);
  const out: Restore[] = [];
  while (left.length) {
    const i = Math.max(0, left.findIndex((x) => !left.some((y) => y !== x && precedes(y, x))));
    out.push(left.splice(i, 1)[0]!);
  }
  return out;
}

function moveOutOfPinned(tabs: Tab[]) {
  if (!tabs.length) return;
  const before = store();
  const spots = tabs.flatMap((t): Restore[] => {
    const spot = listSpots.get(pinKeyOf(t));
    if (!spot) return [];
    listSpots.delete(pinKeyOf(t));
    const tabId = before.windows[spot.windowId]?.tabIds.find((id) => before.tabs[id] && pinKeyOf(before.tabs[id]!) === spot.key);
    return tabId ? [{ ...spot, tabId }] : [];
  });
  store().pinTabs(tabs.map((t) => t.id), false);
  const ordered = inListOrder(spots);
  const placed: Restore[] = [];
  for (const spot of ordered) {
    const s = store();
    const t = s.tabs[spot.tabId];
    if (!t || t.pinned || t.windowId !== spot.windowId) continue;
    const pending = ordered.filter((o) => o !== spot && !placed.includes(o)).map((o) => o.tabId);
    const now = listTabIds(s, spot.windowId, t.profileId, new Set([t.id, ...pending]));
    const keys = now.map((id) => pinKeyOf(s.tabs[id]!));
    const prevKey = spot.list.slice(0, spot.index).reverse().find((k) => keys.includes(k));
    const nextKey = spot.list.slice(spot.index + 1).find((k) => keys.includes(k));
    const after = Math.max(prevKey ? keys.indexOf(prevKey) : -1, ...placed.filter((p) => precedes(p, spot)).map((p) => keys.indexOf(p.key)));
    const prev = after >= 0 ? now[after] : undefined;
    let beforeId = prev ? (now[after + 1] ?? null) : nextKey ? now[keys.indexOf(nextKey)]! : (now[spot.index] ?? null);
    const group = spot.groupId ? s.groups[spot.groupId] : undefined;
    const groupId = group && !group.pinned && group.windowId === spot.windowId && group.profileId === t.profileId ? group.id : undefined;
    if (groupId && !(beforeId && group!.tabIds.includes(beforeId))) {
      beforeId = prev && group!.tabIds.includes(prev) ? null : (group!.tabIds.find((id) => now.includes(id)) ?? null);
    }
    s.placeTabs([t.id], { pinned: false, groupId, beforeId });
    placed.push(spot);
  }
}

export function forgetListSpots() {
  listSpots.clear();
}
