import { useBrowser, type BrowserState } from "../browser/store";
import type { ClosedGroup } from "../browser/types";
import { isIncognitoProfile } from "../browser/model";
import { removeTabs } from "../tabs/tabs";
import { keptDeletedGroups, restoringGroup } from "../pins/closedTabs";

type ClosedGroupsState = Pick<BrowserState, "profiles" | "closedGroups">;
const belongsToProfile = (entry: ClosedGroup, profileId: string) => entry.tabs.length > 0 && entry.tabs.every((tab) => tab.profileId === profileId);
const hasProfile = (s: ClosedGroupsState, profileId: string) => !!s.profiles[profileId] && !isIncognitoProfile(profileId);
const closedGroupForProfile = (s: ClosedGroupsState, entryId: string, profileId: string) =>
  hasProfile(s, profileId) ? s.closedGroups.find((entry) => entry.id === entryId && belongsToProfile(entry, profileId)) : undefined;

export function closedGroupsForProfile(s: ClosedGroupsState, profileId: string) {
  return hasProfile(s, profileId) ? s.closedGroups.filter((entry) => belongsToProfile(entry, profileId)) : [];
}

const barGroupsCache = new WeakMap<ClosedGroup[], {
  profiles: ClosedGroupsState["profiles"]; byProfile: Map<string, ClosedGroup[]>;
}>();

export function closedGroupsOnBarForProfile(s: ClosedGroupsState, profileId: string) {
  let cached = barGroupsCache.get(s.closedGroups);
  if (!cached || cached.profiles !== s.profiles) {
    cached = { profiles: s.profiles, byProfile: new Map() };
    barGroupsCache.set(s.closedGroups, cached);
  }
  let groups = cached.byProfile.get(profileId);
  if (!groups) {
    groups = closedGroupsForProfile(s, profileId).filter((entry) => entry.hiddenFromBar !== true);
    cached.byProfile.set(profileId, groups);
  }
  return groups;
}

export function reopenClosedGroup(entryId: string, windowId: string) {
  const s = useBrowser.getState();
  const window = s.windows[windowId];
  if (!window || window.kind !== "main") return;
  const entry = closedGroupForProfile(s, entryId, window.profileId);
  if (entry) useBrowser.setState(restoringGroup(s, entry, windowId, true));
}

export function deleteClosedGroup(entryId: string, profileId: string) {
  const s = useBrowser.getState();
  const entry = closedGroupForProfile(s, entryId, profileId);
  if (!entry) return;
  useBrowser.setState({
    closedGroups: s.closedGroups.filter((group) => group.id !== entryId),
    deletedGroups: [...keptDeletedGroups(s.deletedGroups), { ...entry, closedAt: Date.now() }],
  });
}

export function unpinClosedGroup(entryId: string, profileId: string) {
  const s = useBrowser.getState();
  const entry = closedGroupForProfile(s, entryId, profileId);
  if (!entry || entry.hiddenFromBar) return;
  useBrowser.setState({ closedGroups: s.closedGroups.map((group) => group.id === entryId ? { ...group, hiddenFromBar: true } : group) });
}

export function reopenClosedGroupInNewWindow(entryId: string, profileId: string) {
  const s = useBrowser.getState();
  const entry = closedGroupForProfile(s, entryId, profileId);
  if (!entry) return;
  const windowId = s.createWindow({ profileId });
  const created = useBrowser.getState();
  const blank = created.windows[windowId]?.tabIds ?? [];
  useBrowser.setState(removeTabs(restoringGroup(created, entry, windowId, true), blank, false));
}

export function openClosedGroupTab(entryId: string, index: number, windowId: string) {
  const s = useBrowser.getState();
  const window = s.windows[windowId];
  if (!window || window.kind !== "main" || !Number.isInteger(index)) return;
  const entry = closedGroupForProfile(s, entryId, window.profileId);
  const tab = entry?.tabs[index];
  if (tab?.url) s.newTab(windowId, { url: tab.url, profileId: window.profileId });
}
