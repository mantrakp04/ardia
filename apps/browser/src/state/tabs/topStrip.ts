import { showMenu, type MenuItem } from "../../platform/menus";
import { create } from "zustand";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, tabLabel, viewTabIds } from "../browser/model";
import { groupIndex, splitIndex, stableList } from "../browser/structure";
import { movingTabIds, resolveDrop, slotDrop, type DragSource, type DropSpot, type Lane } from "../drag/drops";
import { hiddenEmptyCard } from "../omnibox/newTabBarPolicy";
import { groupLabel } from "../pins/organize";
import { folderIn, folderLabel, folderMembers, tileFolderOf } from "../pins/tileFolders";
import { clickTab } from "../sidebar/actions";
import { groupEntries } from "../sidebar/entries";
import { renameFolder } from "../sidebar/tileFolderUi";

export function tuckTarget(s: BrowserState, windowId: string, profileId: string, groupId: string): string | undefined {
  const members = new Set(s.groups[groupId]?.tabIds ?? []);
  let best: string | undefined;
  for (const id of viewTabIds(s, windowId, profileId)) {
    const t = s.tabs[id];
    if (!t || members.has(id)) continue;
    if (!best || t.lastActiveAt > s.tabs[best]!.lastActiveAt) best = id;
  }
  return best;
}


const stripMemo = new Map<string, { inputs: unknown[]; result: string[] }>();

function foldersUnderRoots(groups: BrowserState["groups"]): Map<string, string> {
  const folderOf = new Map<string, string>();
  for (const g of Object.values(groups)) {
    if (!g.parentId || groups[g.parentId]?.parentId) continue;
    for (const id of g.tabIds) folderOf.set(id, g.id);
  }
  return folderOf;
}

export function stripEntries(s: BrowserState, windowId: string, profileId: string): string[] {
  const key = `${windowId}|${profileId}`;
  const inputs = [s.tabs, s.windows, s.groups, s.splits, s.settings.newTabOpens];
  const cached = stripMemo.get(key);
  if (cached && cached.inputs.every((v, i) => v === inputs[i])) return cached.result;
  const groups = groupIndex(s.groups);
  const folders = foldersUnderRoots(s.groups);
  const splits = splitIndex(s.splits);
  const seen = new Set<string>();
  const dock: string[] = [];
  const out: string[] = [];
  const activeId = s.windows[windowId]?.activeTabIds[profileId];
  for (const id of viewTabIds(s, windowId, profileId)) {
    const t = s.tabs[id]!;
    if (hiddenEmptyCard(s, t)) continue;
    const tileFolder = tileFolderOf(t);
    if (tileFolder) {
      if (!seen.has(`tf:${tileFolder.id}`)) dock.push(`tilefolder:${tileFolder.id}:${folderMembers(s, windowId, tileFolder.id).join(",")}`);
      seen.add(`tf:${tileFolder.id}`);
      if (id === activeId) dock.push(`pinned:${id}`);
      continue;
    }
    if (t.pinned) {
      dock.push(`pinned:${id}`);
      continue;
    }
    const group = groups.get(id);
    if (group && !seen.has(group.id)) {
      seen.add(group.id);
      out.push(`group:${group.id}:${group.collapsed ? 1 : 0}`);
    }
    const folder = group && folders.get(id);
    if (folder) {
      if (!seen.has(folder)) out.push(`folder:${folder}:${s.groups[folder]!.tabIds.join(",")}:${group.id}`);
      seen.add(folder);
      continue;
    }
    const split = splits.get(id)?.[0];
    if (split) {
      if (!seen.has(split.id)) out.push(`split:${split.id}:${split.tabIds.join(",")}:${group?.id ?? ""}`);
      seen.add(split.id);
      continue;
    }
    out.push(`tab:${id}:${group?.id ?? ""}`);
  }
  const result = stableList(cached?.result, [...dock, ...out]);
  stripMemo.set(key, { inputs, result });
  if (stripMemo.size > 8) for (const k of stripMemo.keys()) if (!s.windows[k.split("|")[0]!]) stripMemo.delete(k);
  return result;
}

export function tileFolderMenuItems(s: BrowserState, windowId: string, folderId: string, activeId: string | undefined): MenuItem[] {
  return [
    ...folderMembers(s, windowId, folderId).map((id): MenuItem => ({ id: `t:${id}`, title: tabLabel(s.tabs[id]!), checked: id === activeId })),
    { separator: true },
    { id: "rename", title: "Rename Folder…", symbol: "character.cursor.ibeam" },
  ];
}

export function folderMenuItems(s: BrowserState, groupId: string, activeId: string | undefined): MenuItem[] {
  return groupEntries(s, groupId).flatMap((entry): MenuItem[] => {
    const id = entry.slice(2);
    if (entry.startsWith("g:")) {
      const g = s.groups[id];
      return g ? [{ id: entry, title: groupLabel(s, g), symbol: "folder", children: folderMenuItems(s, id, activeId) }] : [];
    }
    const tabIds = entry.startsWith("s:") ? (s.splits[id]?.tabIds ?? []) : [id];
    return tabIds.flatMap((t): MenuItem[] => (s.tabs[t] ? [{ id: `t:${t}`, title: tabLabel(s.tabs[t]!), checked: t === activeId }] : []));
  });
}

export const useStripEntries = (windowId: string, profileId: string) => useBrowser((s) => stripEntries(s, windowId, profileId));

export const useShownTabIdFor = (windowId: string, profileId: string) => useBrowser((s) => s.windows[windowId]?.activeTabIds[profileId] ?? "");

export const useHasTuckTarget = (enabled: boolean, windowId: string, profileId: string, groupId: string) =>
  useBrowser((s) => enabled && !!tuckTarget(s, windowId, profileId, groupId));

export const useTileFolderLabel = (windowId: string, folderId: string) => useBrowser((s) => folderLabel(folderIn(s, windowId, folderId)));

export function tuckGroup(windowId: string, profileId: string, groupId: string) {
  const s = useBrowser.getState();
  const target = tuckTarget(s, windowId, profileId, groupId);
  if (target) s.activate(target);
}

export function inPinnedGroup(tabId: string | undefined): boolean {
  const groups = useBrowser.getState().groups;
  return !!tabId && Object.values(groups).some((g) => g.pinned && g.tabIds.includes(tabId));
}

export const currentMovingTabIds = (tabId: string) => movingTabIds(useBrowser.getState(), tabId);

export function dropTabsInSlot(ids: string[], slots: Parameters<typeof slotDrop>[2], from: number, to: number, lane: Lane): boolean {
  const s = useBrowser.getState();
  return s.dropTabs(ids, slotDrop(s, ids, slots, from, to, lane));
}

export function dropTabsAt(ids: string[], source: DragSource, spot: DropSpot): boolean {
  const s = useBrowser.getState();
  return s.dropTabs(ids, resolveDrop(s, source, spot));
}

export function moveInGroup(groupId: string, beforeId: string | null) {
  const s = useBrowser.getState();
  s.dropTabs([], resolveDrop(s, { kind: "group", groupId }, { zone: s.groups[groupId]?.pinned ? "pinnedRows" : "list", beforeId }));
}

export type StoreMark = object;
export const storeMark = (): StoreMark => useBrowser.getState();
export const storeChangedSince = (mark: StoreMark) => useBrowser.getState() !== mark;

export async function openFolderMenu(windowId: string, groupId: string) {
  const s = useBrowser.getState();
  const choice = await showMenu(folderMenuItems(s, groupId, activeTabId(s, windowId)));
  if (choice?.startsWith("t:") && useBrowser.getState().tabs[choice.slice(2)]) clickTab(windowId, choice.slice(2));
}

export async function openTileFolderStripMenu(windowId: string, folderId: string) {
  const s = useBrowser.getState();
  const choice = await showMenu(tileFolderMenuItems(s, windowId, folderId, activeTabId(s, windowId)));
  if (choice === "rename") void renameFolder(windowId, folderId);
  else if (choice?.startsWith("t:") && useBrowser.getState().tabs[choice.slice(2)]) clickTab(windowId, choice.slice(2));
}

const useStripOnto = create<{ key: string | null }>()(() => ({ key: null }));
export const useStripOntoIs = (key: string | null) => useStripOnto((s) => s.key === key);
export const setStripOnto = (key: string | null) => useStripOnto.setState({ key });
