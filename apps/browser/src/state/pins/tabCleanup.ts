import type { BrowserState } from "../browser/store";
import { activeTabId, inPinnedContainer, pinSection, viewTabIds } from "../browser/model";
import { hasPage } from "../tabs/pageSession";
import { holderOf } from "./pinShare";
import { splitOf } from "../splits/splits";
import { lastUsedOf, sharedLastUsed } from "../tabs/tabShare";
import type { ClosedTab, Tab, TabGroup } from "../browser/types";

export type ClearedTabs = {
  windowId: string;
  entries: ClosedTab[];
  closedEntryIds: string[];
  tabIds: string[];
  groups: TabGroup[];
  fingerprint: string;
  profileId: string;
  remoteDeletions: number;
};

const remotePinDeletions = new Map<string, number>();

export function noteRemotePinDeletion(profileId: string) {
  remotePinDeletions.set(profileId, (remotePinDeletions.get(profileId) ?? 0) + 1);
}

export function unpinnedTabIds(s: BrowserState, windowId: string): string[] {
  return viewTabIds(s, windowId).filter((id) => !inPinnedContainer(s, id));
}

export function isClosedPin(s: BrowserState, id: string): boolean {
  const t = s.tabs[id];
  if (!t || !inPinnedContainer(s, id) || pinSection(t) === "tile") return false;
  return !hasPage(t) && activeTabId(s, t.windowId) !== id && !holderOf(s, id);
}

export function clearedTabIds(s: BrowserState, windowId: string): string[] {
  const ids = unpinnedTabIds(s, windowId);
  const active = activeTabId(s, windowId);
  const kept = new Set(ids.filter((id) => id === active || s.live[id]?.playingAudio));
  for (const id of [...kept]) splitOf(s, id)?.tabIds.forEach((pane) => kept.add(pane));
  return ids.filter((id) => !kept.has(id));
}

export const CLEAN_UP_AFTER_MS = 12 * 60 * 60 * 1000;
export const MAX_CLEANED = 100;

function windowFingerprint(s: BrowserState, windowId: string): string {
  const w = s.windows[windowId];
  if (!w) return "";
  const inWindow = (id: string) => s.tabs[id]?.windowId === windowId;
  const tabs = w.tabIds.map((id) => {
    const t = s.tabs[id];
    return t ? [id, t.profileId, pinSection(t), t.tileFolder?.id ?? ""].join(" ") : id;
  });
  const groups = Object.values(s.groups)
    .filter((g) => g.windowId === windowId)
    .map((g) => [g.id, g.parentId ?? "", g.pinned, g.tabIds.join(",")].join(" "))
    .sort();
  const splits = Object.values(s.splits)
    .filter((v) => v.tabIds.some(inWindow))
    .map((v) => v.tabIds.join(","))
    .sort();
  return [...tabs, "", ...groups, "", ...splits].join("\n");
}

export function undoable(before: BrowserState, after: BrowserState, windowId: string, profileId: string, entries: ClosedTab[]): ClearedTabs {
  return {
    windowId,
    entries,
    closedEntryIds: newClosedEntryIds(before, after),
    tabIds: before.windows[windowId]!.tabIds,
    groups: Object.values(before.groups).filter((g) => g.windowId === windowId),
    fingerprint: windowFingerprint(after, windowId),
    profileId,
    remoteDeletions: remotePinDeletions.get(profileId) ?? 0,
  };
}

export function canUndoClear(s: BrowserState, cleared: ClearedTabs): boolean {
  const closed = new Set(s.closedTabs.map((c) => c.id));
  return (
    (remotePinDeletions.get(cleared.profileId) ?? 0) === cleared.remoteDeletions &&
    cleared.closedEntryIds.every((id) => closed.has(id)) &&
    windowFingerprint(s, cleared.windowId) === cleared.fingerprint
  );
}

function newClosedEntryIds(before: BrowserState, after: BrowserState): string[] {
  return after.closedTabs.filter((c) => !before.closedTabs.includes(c)).map((c) => c.id);
}

const deselectedAt = new Map<string, number>();

export function noteDeselectedTabs(s: BrowserState, ids: readonly string[], at = Date.now()) {
  for (const id of deselectedAt.keys()) if (!s.tabs[id]) deselectedAt.delete(id);
  for (const id of ids) if (s.tabs[id]) deselectedAt.set(id, at);
}

function inactivity(s: BrowserState, windowId: string) {
  const active = activeTabId(s, windowId);
  const grouped = new Set(Object.values(s.groups).flatMap((g) => g.tabIds));
  const inSplit = new Set(Object.values(s.splits).flatMap((v) => v.tabIds));
  const keep = (t: Tab) => t.id === active || inPinnedContainer(s, t.id) || s.live[t.id]?.playingAudio;
  const used = sharedLastUsed(s);
  return {
    active,
    inSplit,
    used,
    keep,
    expires: (t: Tab) => !keep(t) && !grouped.has(t.id) && !inSplit.has(t.id),
    lastUsed: (t: Tab) => Math.max(lastUsedOf(used, t), deselectedAt.get(t.id) ?? 0),
  };
}

export function cleanUpCandidates(s: BrowserState, windowId: string, inactiveForMs = CLEAN_UP_AFTER_MS, now = Date.now()): string[] {
  const view = viewTabIds(s, windowId);
  const { active, inSplit, used, keep, expires, lastUsed } = inactivity(s, windowId);
  const out = new Set<string>();
  const byPage = new Map<string, Tab[]>();
  for (const id of view) {
    const t = s.tabs[id]!;
    if (!t.url) continue;
    const key = t.url.replace(/#.*$/, "");
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }
  for (const same of byPage.values()) {
    if (same.length < 2) continue;
    const keeper = same.find((t) => t.pinned) ?? same.find((t) => t.id === active) ?? [...same].sort((a, b) => lastUsedOf(used, b) - lastUsedOf(used, a))[0]!;
    for (const t of same) if (t !== keeper && !keep(t) && !inSplit.has(t.id)) out.add(t.id);
  }
  for (const id of view) {
    const t = s.tabs[id]!;
    if (expires(t) && now - lastUsed(t) >= inactiveForMs) out.add(id);
  }
  return view.filter((id) => out.has(id));
}

export function nextCleanUpAt(s: BrowserState, windowId: string, inactiveForMs: number): number {
  const { expires, lastUsed } = inactivity(s, windowId);
  let next = Infinity;
  for (const id of viewTabIds(s, windowId)) {
    const t = s.tabs[id]!;
    if (expires(t)) next = Math.min(next, lastUsed(t) + inactiveForMs);
  }
  return next;
}

export function abandonedNewTabs(s: BrowserState, windowId: string): string[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const selected = new Set(Object.values(w.activeTabIds));
  const shown = w.activeTabIds[w.profileId];
  const out = w.tabIds.filter((id) => {
    const t = s.tabs[id];
    return !!t && t.windowId === w.id && !t.url && !t.navigation && !t.adoptId && !t.pinned && id !== shown && !selected.has(id);
  });
  return out.length >= w.tabIds.length ? out.slice(0, w.tabIds.length - 1) : out;
}

export function recentTabIds(s: BrowserState, windowId: string, now = Date.now(), staleAfterMs = CLEAN_UP_AFTER_MS): string[] {
  const view = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const sorted = view.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return sorted.filter((t, i) => i < 2 || now - t.lastActiveAt < staleAfterMs).map((t) => t.id);
}
