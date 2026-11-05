import type { Bookmarks } from "../browser/types";
import { isWithin } from "./bookmarks";

export type DropSpot = { parentId: string; slot: number; zone?: string } | { into: string };

export type ZoneItem = { id: string; start: number; size: number; folder: boolean };

export type ItemHit = { slot: number } | { into: string };

export const sameSpot = (a: DropSpot | null, b: DropSpot | null) =>
  a === b || (!!a && !!b && ("into" in a ? "into" in b && a.into === b.into : "slot" in b && a.parentId === b.parentId && a.slot === b.slot && a.zone === b.zone));

export function zoneHitAt(items: ZoneItem[], at: number, draggedId: string | null, gap = 0): ItemHit {
  const from = draggedId ? items.findIndex((i) => i.id === draggedId) : -1;
  const removed = from >= 0 ? items[from]!.size + gap : 0;
  for (let i = 0; i < items.length; i++) {
    if (i === from) continue;
    const item = items[i]!;
    const start = item.start - (from >= 0 && i > from ? removed : 0);
    if (item.folder && at > start + item.size * 0.25 && at < start + item.size * 0.75) return { into: item.id };
    if (at < start + item.size / 2) return { slot: i };
  }
  return { slot: items.length };
}

export function roomOffsets(ids: string[], draggedId: string | null, slot: number | null, width: number): number[] {
  const from = draggedId ? ids.indexOf(draggedId) : -1;
  return ids.map((id, i) => {
    if (i === from) return 0;
    const pulled = from >= 0 && i > from ? -width : 0;
    const pushed = slot !== null && i >= slot ? width : 0;
    return pulled + pushed;
  });
}


export function moveTarget(b: Bookmarks, id: string, spot: DropSpot): { parentId: string; index: number } | null {
  const node = b.nodes[id];
  if (!node?.parentId) return null;
  const parentId = "into" in spot ? spot.into : spot.parentId;
  const parent = b.nodes[parentId];
  if (parent?.kind !== "folder" || isWithin(b, parentId, [id])) return null;
  if ("into" in spot) return parentId === node.parentId ? null : { parentId, index: parent.children.length };
  const from = node.parentId === parentId ? parent.children.indexOf(id) : -1;
  const slot = Math.max(0, Math.min(spot.slot, parent.children.length));
  if (from >= 0 && (slot === from || slot === from + 1)) return null;
  return { parentId, index: from >= 0 && slot > from ? slot - 1 : slot };
}

export function insertTarget(b: Bookmarks, spot: DropSpot): { parentId: string; index: number } | null {
  const parentId = "into" in spot ? spot.into : spot.parentId;
  const parent = b.nodes[parentId];
  if (parent?.kind !== "folder") return null;
  return { parentId, index: "into" in spot ? parent.children.length : Math.max(0, Math.min(spot.slot, parent.children.length)) };
}

export function linkTitle(url: string, text: string | null | undefined): string {
  const title = text?.trim();
  if (title && title !== url) return title;
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1];
  return host ? host.replace(/^www\./, "") : url;
}
