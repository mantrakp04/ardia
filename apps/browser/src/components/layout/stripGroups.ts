import type { MenuItem } from "@ardia/shell";
import type { BrowserState } from "../../store/browser";
import { tabLabel, viewTabIds } from "../../store/model";
import { hiddenEmptyCard } from "../../store/newTabBar";
import { groupLabel } from "../../store/organize";
import { groupIndex, splitIndex, stableList } from "../../store/structure";
import { folderMembers, tileFolderOf } from "../../store/tileFolders";
import { groupEntries } from "../sidebar/entries";
import { springParams } from "./swipeMotion";

export const GROUP_MARGIN_LEFT = 3.5;
export const GROUP_MARGIN_RIGHT = 4;
export const MEMBERS_INSET = 6.5;
const TAIL_COLLAPSED = 4.5;
export const TAIL_EXPANDED = 30.25;
export const GROUP_SPRING = springParams(0.3, 0.82);
export const TUCK_FADE_MS = 120;

type GroupLayout = { offsets: number[]; width: number };

export function groupLayout(chip: number, widths: number[], gap: number, expanded: boolean, shown: number): GroupLayout {
  const offsets: number[] = [];
  let x = 0;
  for (const w of widths) {
    offsets.push(x);
    x += w + gap;
  }
  const members = widths.length ? x - gap : 0;
  if (expanded && widths.length) return { offsets, width: chip + MEMBERS_INSET + members + TAIL_EXPANDED };
  if (shown >= 0 && widths[shown] !== undefined) return { offsets, width: chip + MEMBERS_INSET + widths[shown]! + TAIL_COLLAPSED };
  return { offsets, width: chip };
}

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

export function stripTabWidth(o: {
  pageWidth: number;
  dockWidth: number;
  groups: { chip: number; expanded: boolean; shown: boolean }[];
  tabUnits: number;
  fixed: number;
  gap: number;
  plus: number;
  min: number;
  max: number;
}): number {
  let room = o.pageWidth - o.dockWidth - o.plus - o.gap - o.fixed;
  for (const g of o.groups) {
    const parts = g.expanded ? MEMBERS_INSET + TAIL_EXPANDED : g.shown ? MEMBERS_INSET + TAIL_COLLAPSED : 0;
    room -= GROUP_MARGIN_LEFT + GROUP_MARGIN_RIGHT + g.chip + parts + o.gap;
  }
  const width = o.tabUnits ? room / o.tabUnits - o.gap : o.max;
  return Math.round(Math.max(o.min, Math.min(o.max, width)) * 2) / 2;
}

export type DragSlot = { tabIds: string[]; width: number; marginLeft?: number; marginRight?: number };
export type DragGeometry = { slots: DragSlot[]; lefts: number[] };

export function dragGeometry(slots: DragSlot[], gap: number): DragGeometry {
  const lefts: number[] = [];
  let x = 0;
  for (const slot of slots) {
    x += slot.marginLeft ?? 0;
    lefts.push(x);
    x += slot.width + (slot.marginRight ?? 0) + gap;
  }
  return { slots, lefts };
}

export function dragRange({ slots, lefts }: DragGeometry, from: number): [number, number] {
  const last = slots.length - 1;
  return [lefts[0]! - lefts[from]!, lefts[last]! + slots[last]!.width - (lefts[from]! + slots[from]!.width)];
}

export function dropIndex({ slots, lefts }: DragGeometry, from: number, dx: number): number {
  const left = lefts[from]! + dx;
  const right = left + slots[from]!.width;
  let index = 0;
  slots.forEach((slot, i) => {
    const centre = lefts[i]! + slot.width / 2;
    if (i < from ? centre < left : i > from && centre < right) index++;
  });
  return index;
}

export type Aim = { to: number; onto: number | null };

export function aimDrop({ slots, lefts }: DragGeometry, from: number, pointer: number, target: (index: number) => boolean, edge: number): Aim {
  let to = 0;
  let onto: number | null = null;
  slots.forEach((slot, i) => {
    if (i === from) return;
    const left = lefts[i]!;
    const right = left + slot.width;
    const zone = target(i) ? Math.min(slot.width / 4, edge) : slot.width / 2;
    if (target(i) && pointer > left + zone && pointer < right - zone) onto = i;
    if (i < from ? pointer > left + zone : pointer > right - zone) to++;
  });
  return { to, onto };
}

export function moveIndex(section: string[], tabId: string, slots: DragSlot[], from: number, to: number): number | null {
  if (to === from) return null;
  const moved = section.filter((id) => id !== tabId);
  const others = slots.filter((_, i) => i !== from);
  const anchor = to < others.length ? others[to]!.tabIds[0] : others[others.length - 1]?.tabIds.at(-1);
  const at = anchor ? moved.indexOf(anchor) : -1;
  if (at < 0) return null;
  return to < others.length ? at : at + 1;
}

export function leaveIndex({ slots, lefts }: DragGeometry, slot: number, chip: number, expanded: boolean, left: number, width: number): number | null {
  const start = lefts[slot]!;
  const end = start + slots[slot]!.width;
  const right = left + width;
  const centre = (i: number) => lefts[i]! + slots[i]!.width / 2;
  if (left < start + chip / 2) {
    let at = slot;
    while (at > 0 && centre(at - 1) > left) at--;
    return at;
  }
  if (right > (expanded ? end - TAIL_EXPANDED / 2 : end + MEMBERS_INSET)) {
    let at = slot + 1;
    while (at < slots.length && centre(at) < right) at++;
    return at;
  }
  return null;
}

export function memberInteractive(shown: boolean, expanded: boolean, moving: boolean): boolean {
  return shown || (expanded && !moving);
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
