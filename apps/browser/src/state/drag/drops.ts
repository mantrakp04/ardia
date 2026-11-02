import type { BrowserState } from "../browser/store";
import { ancestorIds, innermostGroupOf } from "../groups/groups";
import { activeTabId, pinSection, viewTabIds } from "../browser/model";
import { selectedTabIds } from "../pins/organize";
import { canMoveGroup, movingGroup, type GroupPlacement } from "../pins/tabGrouping";
import { groupingOnto, placing, type TabPlacement } from "../pins/placing";
import { splitOf } from "../splits/splits";
import { addToTileFolder, tileFolderOf } from "../pins/tileFolders";
import { entryKey } from "../sidebar/entryKey";

type Slot = { readonly tabIds: readonly string[] };
type Order = Pick<BrowserState, "tabs" | "windows">;

export type Lane = { pinned: boolean; groupId: string | null };

export type DragSource = { kind: "tab" | "split" | "group" | "live"; groupId?: string; folderId?: string; external?: boolean };

export type DropSpot =
  | { zone: "tiles"; beforeId: string | null }
  | { zone: "pins"; beforeId: string | null }
  | { zone: "pinnedRows"; beforeId: string | null }
  | { zone: "list"; beforeId: string | null }
  | { zone: "group"; groupId: string; beforeId: string | null }
  | { zone: "onto"; targetId: string }
  | { zone: "folder"; ontoId: string; beforeId?: string | null };

export type Drop =
  | { type: "tabs"; placement: TabPlacement }
  | { type: "group"; groupId: string; placement: GroupPlacement }
  | { type: "live" }
  | { type: "onto"; targetId: string }
  | { type: "folder"; ontoId: string; beforeId?: string | null }
  | { type: "none" };

export const NO_DROP: Drop = { type: "none" };

export type ClickMods = { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

export function firstStaying(slots: readonly Slot[], moving: readonly string[]): string | null {
  for (const slot of slots) for (const id of slot.tabIds) if (!moving.includes(id)) return id;
  return null;
}

export function tabAfter(s: Order, id: string | undefined, moving: readonly string[]): string | null {
  const w = id ? s.windows[s.tabs[id]?.windowId ?? ""] : undefined;
  if (!w || !id) return null;
  return w.tabIds.slice(w.tabIds.indexOf(id) + 1).find((t) => !moving.includes(t)) ?? null;
}

export function slotAnchor(s: Order, slots: readonly Slot[], from: number, to: number, moving: readonly string[]): string | null {
  const others = slots.filter((_, i) => i !== from);
  return firstStaying(others.slice(to), moving) ?? tabAfter(s, others.at(-1)?.tabIds.at(-1), moving);
}

export function laneSpot({ pinned, groupId }: Lane, beforeId: string | null): DropSpot {
  if (groupId) return { zone: "group", groupId, beforeId };
  return { zone: pinned ? "pins" : "list", beforeId };
}

export function slotDrop(s: BrowserState, ids: readonly string[], slots: readonly Slot[], from: number, to: number, lane: Lane): Drop {
  if (to === from || !ids.length) return NO_DROP;
  return resolveDrop(s, { kind: "tab" }, laneSpot(lane, slotAnchor(s, slots, from, to, ids)));
}

const tabsAt = (placement: TabPlacement): Drop => ({ type: "tabs", placement });

function dropAt(source: DragSource, spot: DropSpot): Drop {
  const tabs = source.kind === "tab" || source.kind === "split";
  const group = source.kind === "group" ? source.groupId : undefined;
  const moveGroup = (placement: GroupPlacement): Drop => (group ? { type: "group", groupId: group, placement } : NO_DROP);
  switch (spot.zone) {
    case "tiles":
      return source.kind === "tab" ? tabsAt({ pinned: true, row: false, beforeId: spot.beforeId, ...(source.folderId ? {} : { tileFolder: null }) }) : NO_DROP;
    case "pins":
      return source.kind === "tab" ? tabsAt({ pinned: true, beforeId: spot.beforeId }) : NO_DROP;
    case "pinnedRows":
      if (tabs) return tabsAt({ pinned: true, row: true, beforeId: spot.beforeId, ...(spot.beforeId ? {} : { last: true }) });
      return source.kind === "live" ? { type: "live" } : moveGroup({ pinned: true, parentId: null, beforeId: spot.beforeId });
    case "list":
      if (tabs) return tabsAt({ pinned: false, beforeId: spot.beforeId });
      return moveGroup({ pinned: false, parentId: null, beforeId: spot.beforeId });
    case "group":
      if (tabs) return tabsAt({ pinned: false, groupId: spot.groupId, beforeId: spot.beforeId });
      return moveGroup({ pinned: false, parentId: spot.groupId, beforeId: spot.beforeId });
    case "onto":
      return source.kind === "tab" && !source.external ? { type: "onto", targetId: spot.targetId } : NO_DROP;
    case "folder":
      return source.kind === "tab" && !source.external ? { type: "folder", ontoId: spot.ontoId, beforeId: spot.beforeId } : NO_DROP;
  }
}

export function resolveDrop(s: Pick<BrowserState, "groups">, source: DragSource, spot: DropSpot | null): Drop {
  const drop = spot ? dropAt(source, spot) : NO_DROP;
  if (drop.type === "group" && !canMoveGroup(s.groups, drop.groupId, drop.placement)) return NO_DROP;
  return drop;
}

export function dropping(s: BrowserState, ids: string[], drop: Drop): BrowserState {
  switch (drop.type) {
    case "tabs":
      return placing(s, ids, drop.placement);
    case "group": {
      const moved = movingGroup(s, drop.groupId, drop.placement);
      return Object.keys(moved).length ? { ...s, ...moved } : s;
    }
    case "onto":
      return groupingOnto(s, ids, drop.targetId)[0];
    case "folder":
      return addToTileFolder(s, ids, drop.ontoId, drop.beforeId);
    default:
      return s;
  }
}

export function stepDrop(s: BrowserState, tabId: string, delta: 1 | -1): Drop {
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w || tileFolderOf(tab)) return NO_DROP;
  const chainOf = (id: string) => {
    const g = innermostGroupOf(s.groups, id);
    return g ? [g.id, ...ancestorIds(s.groups, g.id)] : [];
  };
  const lane = (id: string) => (s.groups[chainOf(id).at(-1) ?? ""]?.pinned ? "row" : pinSection(s.tabs[id]));
  const container = innermostGroupOf(s.groups, tabId);
  const blockOf = (id: string): string | null => {
    const chain = chainOf(id);
    const at = container ? chain.indexOf(container.id) : chain.length;
    if (at < 0) return null;
    if (at > 0) return entryKey("group", chain[at - 1]!);
    const folder = tileFolderOf(s.tabs[id]);
    return folder ? entryKey("tileFolder", folder.id) : entryKey("tab", splitOf(s, id)?.id ?? id);
  };
  const blocks: { key: string; ids: string[] }[] = [];
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (t?.profileId !== tab.profileId || lane(id) !== lane(tabId)) continue;
    const key = blockOf(id);
    if (key === null) continue;
    const last = blocks.at(-1);
    if (last?.key === key) last.ids.push(id);
    else blocks.push({ key, ids: [id] });
  }
  const at = blocks.findIndex((b) => b.ids.includes(tabId));
  if (at < 0) return NO_DROP;
  const next = blocks[at + delta];
  if (next) {
    const beforeId = delta < 0 ? next.ids[0]! : (blocks[at + 2]?.ids[0] ?? null);
    return tabsAt({ pinned: !!tab.pin, groupId: container?.id ?? null, beforeId, ...(beforeId ? {} : { last: true }) });
  }
  if (!container || (container.pinned && !container.parentId)) return NO_DROP;
  const parent = container.parentId ? s.groups[container.parentId] : undefined;
  const after = w.tabIds.slice(w.tabIds.indexOf(container.tabIds.at(-1)!) + 1).find((id) => !container.tabIds.includes(id) && (!parent || parent.tabIds.includes(id)));
  const beforeId = delta < 0 ? (container.tabIds.find((id) => !blocks[at]!.ids.includes(id)) ?? after ?? null) : (after ?? null);
  return tabsAt({ pinned: !!tab.pin, groupId: parent?.id ?? null, beforeId });
}

export function movingTabIds(s: BrowserState, tabId: string): string[] {
  const windowId = s.tabs[tabId]?.windowId;
  const selected = windowId && (s.selection[windowId]?.length ?? 0) > 1 ? selectedTabIds(s, windowId) : [];
  return selected.length > 1 && selected.includes(tabId) ? selected : [tabId];
}

export function clickedSelection(s: BrowserState, windowId: string, tabId: string, mods: ClickMods): { selection: string[]; anchor: string | undefined } | null {
  const active = activeTabId(s, windowId);
  const anchor = s.selectionAnchors[windowId];
  if (mods.metaKey) {
    const current = s.selection[windowId] ?? [];
    const base = current.length ? current : active ? [active] : [];
    const next = base.includes(tabId) ? base.filter((id) => id !== tabId) : [...base, tabId];
    return { selection: next.length > 1 ? next : [], anchor: tabId };
  }
  if (!mods.shiftKey) return null;
  const view = viewTabIds(s, windowId);
  const from = view.indexOf(anchor ?? active ?? tabId);
  const to = view.indexOf(tabId);
  if (from < 0 || to < 0) return null;
  return { selection: view.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
}
