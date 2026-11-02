import type { BrowserState } from "../browser/store";
import { rootOf } from "../groups/groups";
import type { BrowserWindow, ParkedPins, TabGroup } from "../browser/types";
import { entryKey, parseEntry } from "../sidebar/entryKey";
import { isPinnedRow, pinKeyOf } from "../browser/model";

type Block = { key: string; row: boolean; ids: string[] };

function pinnedBlocks(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): Block[] {
  const blocks: Block[] = [];
  const byRoot = new Map<string, Block>();
  const pinnedRoot = new Map<string, TabGroup>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned || g.windowId !== w.id || g.profileId !== profileId) continue;
    const root = rootOf(s.groups, g.id) ?? g;
    for (const id of g.tabIds) pinnedRoot.set(id, root);
  }
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId) continue;
    if (t.pin) {
      if (isPinnedRow(t)) blocks.push({ key: entryKey("tab", pinKeyOf(t)), row: true, ids: [id] });
      continue;
    }
    const root = pinnedRoot.get(id);
    if (!root) continue;
    const known = byRoot.get(root.id);
    if (known) known.ids.push(id);
    else {
      const block = { key: entryKey("group", pinKeyOf(root)), row: false, ids: [id] };
      byRoot.set(root.id, block);
      blocks.push(block);
    }
  }
  return blocks;
}

export type Anchors = Map<string, string | null>;

export function anchorsOf(keys: string[]): Anchors {
  const anchors: Anchors = new Map();
  let row: string | null = null;
  for (const key of keys) {
    const { kind, id } = parseEntry(key);
    if (kind === "tab") row = id;
    else anchors.set(id, row);
  }
  return anchors;
}

function parkedBlocks(park: ParkedPins): Block[] {
  const parentOf = new Map(park.groups.map((g) => [g.id, g.parentId]));
  const rootOf = (id: string) => {
    const seen = new Set([id]);
    let root = id;
    for (let up = parentOf.get(root); up && parentOf.has(up) && !seen.has(up); up = parentOf.get(root)) {
      seen.add(up);
      root = up;
    }
    return root;
  };
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  for (const t of park.tabs) {
    const key = t.groupId ? entryKey("group", rootOf(t.groupId)) : isPinnedRow(t) ? entryKey("tab", t.id) : null;
    if (!key) continue;
    const known = byKey.get(key);
    if (known) known.ids.push(t.id);
    else {
      const block = { key, row: !t.groupId, ids: [t.id] };
      byKey.set(key, block);
      blocks.push(block);
    }
  }
  return blocks;
}

export function parkedAreaKeys(s: Pick<BrowserState, "parkedPins">, profileId: string): string[] {
  const park = s.parkedPins[profileId];
  return park ? parkedBlocks(park).map((b) => b.key) : [];
}

export const parkedAnchors = (s: Pick<BrowserState, "parkedPins">, profileId: string): Anchors => anchorsOf(parkedAreaKeys(s, profileId));

export function arrangeParked(park: ParkedPins, anchorOf: (groupKey: string) => string | null | undefined): ParkedPins {
  const order = orderBlocks(parkedBlocks(park), anchorOf);
  if (!order) return park;
  const byId = new Map(park.tabs.map((t) => [t.id, t]));
  const ids = rearranged(park.tabs.map((t) => t.id), order);
  return ids === null ? park : { ...park, tabs: ids.map((id) => byId.get(id)!) };
}

export const pinnedAreaKeys = (s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): string[] =>
  pinnedBlocks(s, w, profileId).map((b) => b.key);

export const pinnedAnchors = (s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): Anchors => anchorsOf(pinnedAreaKeys(s, w, profileId));

function orderBlocks(blocks: Block[], anchorOf: (groupKey: string) => string | null | undefined): string[] | null {
  const rows = blocks.filter((b) => b.row);
  const groups = blocks.filter((b) => !b.row);
  const rowKeys = new Set(rows.map((r) => parseEntry(r.key).id));
  const placed = new Map<string | null, Block[]>();
  const last: Block[] = [];
  for (const g of groups) {
    const anchor = anchorOf(parseEntry(g.key).id);
    if (anchor === null || (anchor !== undefined && rowKeys.has(anchor))) placed.get(anchor)?.push(g) ?? placed.set(anchor, [g]);
    else last.push(g);
  }
  if (!groups.some((g) => anchorOf(parseEntry(g.key).id) !== undefined)) return null;
  return [...(placed.get(null) ?? []), ...rows.flatMap((r) => [r, ...(placed.get(parseEntry(r.key).id) ?? [])]), ...last].flatMap((b) => b.ids);
}

function rearranged(ids: string[], order: string[]): string[] | null {
  const area = new Set(order);
  const at = ids.findIndex((id) => area.has(id));
  const rest = ids.filter((id) => !area.has(id));
  const next = [...rest.slice(0, at), ...order, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? null : next;
}

export function arrangePinnedArea(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, anchorOf: (groupKey: string) => string | null | undefined): string[] {
  const order = orderBlocks(pinnedBlocks(s, w, profileId), anchorOf);
  return (order && rearranged(w.tabIds, order)) ?? w.tabIds;
}
