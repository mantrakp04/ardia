import type { StripDock, StripEntry, StripGroupEntry, StripMember } from "../../state/tabs/topStrip";
import { spring } from "../ui/motion";
import type { Dock, DropTarget } from "./model";
import { DOCK_GAP, GAP, ITEM_HEIGHT, MAX_CHIP, MIN_CHIP, PINNED_CELL, PINNED_SPACING } from "./tokens";

export const GROUP_MARGIN_LEFT = 3.5;
export const GROUP_MARGIN_RIGHT = 4;
export const MEMBERS_INSET = 6.5;
const TAIL_COLLAPSED = 4.5;
export const TAIL_EXPANDED = 30.25;
export const GROUP_SPRING = spring({ response: 0.3, damping: 0.82 });
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

export function dockCellOf(cells: string[], members: (cell: string) => string[], tabId: string): number {
  const own = cells.indexOf(tabId);
  return own >= 0 ? own : cells.findIndex((cell) => members(cell).includes(tabId));
}

export function revealOffset(left: number, width: number, scrolled: number, viewport: number, pad: number): number | null {
  const toStart = left - pad;
  const toEnd = left + width + pad - viewport;
  const target = toStart < scrolled ? toStart : toEnd > scrolled ? Math.min(toStart, toEnd) : scrolled;
  const clamped = Math.max(0, target);
  return Math.abs(clamped - scrolled) < 0.5 ? null : clamped;
}

export function memberInteractive(shown: boolean, expanded: boolean, moving: boolean): boolean {
  return shown || (expanded && !moving);
}

export const holds = (m: StripMember, tabId: string) => (m.kind === "tab" ? m.id === tabId : m.tabIds.includes(tabId));
export const tabsOf = (m: StripMember) => (m.kind === "tab" ? [m.id] : m.tabIds);
export const units = (m: StripMember, activeId: string) => (m.kind === "split" ? Math.min(m.tabIds.length, 2) : m.kind === "folder" ? (holds(m, activeId) ? 1 : 0) : 1);
export const CELL_STEP = PINNED_CELL + PINNED_SPACING;
export const dockWidth = (cells: number) => cells * CELL_STEP - PINNED_SPACING;

export type StripMeasures = { groupChip: (groupId: string) => number | undefined; folderChip: (groupId: string) => number | undefined };
export type StripLayout = {
  chip: number;
  top: DragGeometry;
  targets: (DropTarget | null)[];
  memberWidth: (m: StripMember) => number;
  spanOf: (tabId: string) => [number, number] | null;
};

const dockEntry = (entries: StripEntry[]) => entries.find((e): e is StripDock => e.kind === "dock");
const dockTabs = (dock: StripDock, cell: string) => dock.members.get(cell) ?? [cell];
const dockSpan = (dock: StripDock | undefined) => (dock?.ids.length ? dockWidth(dock.ids.length) + DOCK_GAP : 0);

export function layoutDock(dock: StripDock | undefined): Dock | null {
  if (!dock?.ids.length) return null;
  return { ids: dock.ids, left: -dockSpan(dock), geometry: dragGeometry(dock.ids.map((id) => ({ tabIds: dockTabs(dock, id), width: PINNED_CELL })), PINNED_SPACING) };
}

export function layoutStrip(entries: StripEntry[], activeId: string, pageWidth: number, measured: StripMeasures, dockLayout: Dock | null): StripLayout {
  const dock = dockEntry(entries);
  const rows = entries.filter((e): e is StripGroupEntry | StripMember => e.kind !== "dock");
  const groupChip = (g: StripGroupEntry) => measured.groupChip(g.id) ?? 0;
  const folderChip = (m: StripMember) => measured.folderChip(m.id) ?? 0;
  const visible = rows.flatMap((e) => (e.kind !== "group" ? [e] : e.collapsed ? e.members.filter((m) => holds(m, activeId)) : e.members));
  const chip = stripTabWidth({
    pageWidth,
    dockWidth: dockSpan(dock),
    groups: rows.flatMap((e) => (e.kind === "group" ? [{ chip: groupChip(e), expanded: !e.collapsed, shown: e.members.some((m) => holds(m, activeId)) }] : [])),
    tabUnits: visible.reduce((n, m) => n + units(m, activeId), 0),
    fixed: visible.reduce((n, m) => n + (m.kind === "folder" ? folderChip(m) + (holds(m, activeId) ? MEMBERS_INSET : GAP) : 0), 0),
    gap: GAP,
    plus: ITEM_HEIGHT,
    min: MIN_CHIP,
    max: MAX_CHIP,
  });
  const memberWidth = (m: StripMember) => (m.kind === "folder" ? folderChip(m) + (holds(m, activeId) ? MEMBERS_INSET + chip : 0) : chip * units(m, activeId));
  const groups = new Map(
    rows.flatMap((e) => {
      if (e.kind !== "group") return [];
      const widths = e.members.map(memberWidth);
      return [[e, { widths, ...groupLayout(groupChip(e), widths, GAP, !e.collapsed, e.members.findIndex((m) => holds(m, activeId))) }] as const];
    }),
  );
  const top = dragGeometry(
    rows.map((e): DragSlot => {
      if (e.kind !== "group") return { tabIds: tabsOf(e), width: chip * units(e, activeId) };
      return { tabIds: e.members.flatMap(tabsOf), width: groups.get(e)!.width, marginLeft: GROUP_MARGIN_LEFT, marginRight: GROUP_MARGIN_RIGHT };
    }),
    GAP,
  );
  const targets = rows.map((e) => (e.kind === "split" || e.kind === "folder" ? null : { kind: e.kind, id: e.id }));
  const spanOf = (tabId: string): [number, number] | null => {
    const cell = dock && dockLayout ? dockCellOf(dock.ids, (id) => dockTabs(dock, id), tabId) : -1;
    if (cell >= 0) return [dockLayout!.geometry.lefts[cell]!, PINNED_CELL];
    const i = top.slots.findIndex((slot) => slot.tabIds.includes(tabId));
    if (i < 0) return null;
    const left = dockSpan(dock) + top.lefts[i]!;
    const row = rows[i]!;
    if (row.kind !== "group") return [left, top.slots[i]!.width];
    const at = row.members.findIndex((m) => holds(m, tabId));
    const { widths, offsets } = groups.get(row)!;
    return [left + groupChip(row) + MEMBERS_INSET + (row.collapsed ? 0 : offsets[at]!), widths[at]!];
  };
  return { chip, top, targets, memberWidth, spanOf };
}
