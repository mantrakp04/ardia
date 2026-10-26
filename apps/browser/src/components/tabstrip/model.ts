import type { Animated } from "react-native";
import type { DropSpot } from "../../state/drag/drops";
import { folderCell } from "../../state/pins/tileFolders";
import { dropTabsAt, dropTabsInSlot, useStripOntoIs } from "../../state/tabs/topStrip";
import type { DragGeometry } from "./stripGroups";
import { PINNED_CELL, PINNED_SPACING } from "./tokens";

export type Member = { kind: "tab"; id: string; group: string | null } | { kind: "split" | "folder"; id: string; tabIds: string[]; group: string | null };
export type GroupEntry = { kind: "group"; id: string; collapsed: boolean; members: Member[] };
export type Entry = { kind: "dock"; ids: string[]; members: Map<string, string[]> } | GroupEntry | Member;
export type DropTarget = { kind: "tab" | "group"; id: string };

export const ontoKey = (target: DropTarget | null) => (target ? `${target.kind}:${target.id}` : null);
export const useOnto = (target: DropTarget) => useStripOntoIs(ontoKey(target));

export function parseEntries(keys: string[]): Entry[] {
  const out: Entry[] = [];
  const groups = new Map<string, GroupEntry>();
  for (const key of keys) {
    const [kind, id, a, b] = key.split(":");
    if (kind === "pinned" || kind === "tilefolder") {
      const cell = kind === "tilefolder" ? folderCell(id!) : id!;
      const last = out[out.length - 1];
      const dock = last?.kind === "dock" ? last : { kind: "dock" as const, ids: [], members: new Map<string, string[]>() };
      if (dock !== last) out.push(dock);
      dock.ids.push(cell);
      if (kind === "tilefolder") dock.members.set(cell, a!.split(","));
      continue;
    }
    if (kind === "group") {
      const group: GroupEntry = { kind, id: id!, collapsed: a === "1", members: [] };
      groups.set(group.id, group);
      out.push(group);
      continue;
    }
    const member: Member = kind === "split" || kind === "folder" ? { kind, id: id!, tabIds: a!.split(","), group: b || null } : { kind: "tab", id: id!, group: a || null };
    const group = member.group ? groups.get(member.group) : undefined;
    if (group) group.members.push(member);
    else out.push(member);
  }
  return out;
}

export const chipKey = (groupId: string) => `strip-group-chip|${groupId}`;
export const folderKey = (groupId: string) => `strip-folder-chip|${groupId}`;
export const holds = (m: Member, tabId: string) => (m.kind === "tab" ? m.id === tabId : m.tabIds.includes(tabId));
export const tabsOf = (m: Member) => (m.kind === "tab" ? [m.id] : m.tabIds);
export const units = (m: Member, activeId: string) => (m.kind === "split" ? Math.min(m.tabIds.length, 2) : m.kind === "folder" ? (holds(m, activeId) ? 1 : 0) : 1);

export type StripDrag = {
  tabId: string | null;
  ids: () => string[];
  pinned: boolean;
  groupId: string | null;
  geometry: DragGeometry;
  from: number;
  width: number;
  gap: number;
  axis?: "x" | "y";
  range?: [number, number] | ((grab: number) => [number, number]);
  drop?: (dx: number, ids: string[]) => boolean;
  cross?: Cross;
  targets?: (DropTarget | null)[];
  levels?: number;
  local?: boolean;
};

export type Landing = { dx: number; commit: () => void };
export type Cross = { at: (dx: number, grab: number) => boolean; land: (dx: number, grab: number, ids: string[]) => Landing | null; clear: () => void };

export type Dock = { ids: string[]; left: number; geometry: DragGeometry };
export type Strip = { dock: Dock | null; top: DragGeometry; targets: (DropTarget | null)[]; chip: number; grow: Animated.Value };
export const CELL_STEP = PINNED_CELL + PINNED_SPACING;
export const dockWidth = (cells: number) => cells * CELL_STEP - PINNED_SPACING;

export function reorder(ids: string[], { geometry, from, pinned, groupId }: StripDrag, to: number): boolean {
  return dropTabsInSlot(ids, geometry.slots, from, to, { pinned, groupId });
}

export function dropAt(ids: string[], spot: DropSpot): boolean {
  return dropTabsAt(ids, { kind: "tab" }, spot);
}

export const dropOnto = (target: DropTarget, ids: string[]) =>
  dropAt(ids, target.kind === "tab" ? { zone: "onto", targetId: target.id } : { zone: "group", groupId: target.id, beforeId: null });

export type GroupOut = { top: DragGeometry; slot: number; chip: number; expanded: boolean; left: number };
