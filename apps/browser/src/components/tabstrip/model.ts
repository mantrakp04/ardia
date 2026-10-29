import type { Animated } from "react-native";
import type { DropSpot } from "../../state/drag/drops";
import { dropTabsAt, dropTabsInSlot, useStripOntoIs } from "../../state/tabs/topStrip";
import type { DragGeometry } from "./stripGroups";

export type DropTarget = { kind: "tab" | "group"; id: string };

export const ontoKey = (target: DropTarget | null) => (target ? `${target.kind}:${target.id}` : null);
export const useOnto = (target: DropTarget) => useStripOntoIs(ontoKey(target));

export const chipKey = (groupId: string) => `strip-group-chip|${groupId}`;
export const folderKey = (groupId: string) => `strip-folder-chip|${groupId}`;

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

export function reorder(ids: string[], { geometry, from, pinned, groupId }: StripDrag, to: number): boolean {
  return dropTabsInSlot(ids, geometry.slots, from, to, { pinned, groupId });
}

export function dropAt(ids: string[], spot: DropSpot): boolean {
  return dropTabsAt(ids, { kind: "tab" }, spot);
}

export const dropOnto = (target: DropTarget, ids: string[]) =>
  dropAt(ids, target.kind === "tab" ? { zone: "onto", targetId: target.id } : { zone: "group", groupId: target.id, beforeId: null });

export type GroupOut = { top: DragGeometry; slot: number; chip: number; expanded: boolean; left: number };

export type Release = { kind: "handedOff" } | { kind: "across"; landing: Landing } | { kind: "dropped" } | { kind: "settle" };

export type ReleaseSteps = {
  local: boolean;
  lifted: boolean;
  from: number;
  drops: boolean;
  crossed: boolean;
  endWindowDrag(): boolean;
  landAcross(): Landing | null | undefined;
  clearAim(): void;
  dropOnto(): boolean;
  move(): boolean;
};

export function releaseDrop(s: ReleaseSteps): Release {
  if ((!s.local && (s.endWindowDrag() || s.lifted)) || (s.from < 0 && !s.drops)) return { kind: "handedOff" };
  const landing = s.crossed ? s.landAcross() : null;
  if (landing) return { kind: "across", landing };
  s.clearAim();
  if (!s.local && (s.dropOnto() || s.move())) return { kind: "dropped" };
  return s.from < 0 ? { kind: "handedOff" } : { kind: "settle" };
}
