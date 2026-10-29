import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { arrangeFolders, live, useLive } from "../live/store";
import type { LiveFolder } from "../live/types";
import { useBrowser, type BrowserState } from "../browser/store";
import { pinnedAreaKeys } from "../pins/pinnedArea";
import { findLast, isPinnedRow, pinKeyOf } from "../browser/model";
import { splitRowPanes, splitTabIdsOf } from "../splits/splits";
import { mainWindowFor } from "../windows/small";
import { sidebarEntries } from "../sidebar/entries";
import { entryId, entryKey, parseEntry } from "./entryKey";

export function anchorKey(s: Pick<BrowserState, "tabs" | "groups" | "splits" | "windows">, entry: string): string {
  const { kind, id } = parseEntry(entry);
  if (kind === "split") {
    const panes = splitTabIdsOf(s.splits[id]) ?? [];
    const last = findLast(s.windows[s.splits[id]?.windowId ?? ""]?.tabIds ?? [], (t) => panes.includes(t));
    return entryKey("tab", last && s.tabs[last] ? pinKeyOf(s.tabs[last]!) : id);
  }
  const x = kind === "group" ? s.groups[id] : s.tabs[id];
  return entryKey(kind, x ? pinKeyOf(x) : id);
}

const foldersOf = (folders: Record<string, LiveFolder>, order: string[], spaceId: string): LiveFolder[] =>
  order.map((id) => folders[id]).filter((f): f is LiveFolder => f?.spaceId === spaceId);

export function withLiveFolders(entries: string[], keys: string[], folders: Pick<LiveFolder, "id" | "after">[]): string[] {
  if (!folders.length) return entries;
  const known = new Set(keys);
  const at = (after: string | null) => folders.filter((f) => f.after === after).map((f) => entryKey("live", f.id));
  const out = at(null);
  entries.forEach((entry, i) => out.push(entry, ...at(keys[i]!)));
  for (const f of folders) if (f.after === undefined || (f.after !== null && !known.has(f.after))) out.push(entryKey("live", f.id));
  return out;
}

export function liveAnchors(sequence: string[], keyOf: (entry: string) => string): { id: string; after: string | null }[] {
  let after: string | null = null;
  const out: { id: string; after: string | null }[] = [];
  for (const entry of sequence) {
    const folderId = entryId(entry, "live");
    if (folderId !== null) out.push({ id: folderId, after });
    else after = keyOf(entry);
  }
  return out;
}

export function pinnedSequence(s: BrowserState, folders: Record<string, LiveFolder>, order: string[], windowId: string, spaceId: string): string[] {
  const { pinned } = sidebarEntries(s, windowId, spaceId);
  if (s.windows[windowId]?.kind === "private") return pinned;
  return withLiveFolders(pinned, pinned.map((e) => anchorKey(s, e)), foldersOf(folders, order, spaceId));
}

const stillPinned = (s: Pick<BrowserState, "tabs" | "groups" | "splits">, entry: string, spaceId: string | undefined): boolean => {
  const { kind, id } = parseEntry(entry);
  if (kind === "split") return splitRowPanes(s, s.splits[id]).some((t) => s.tabs[t]!.pin && s.tabs[t]!.spaceId === spaceId);
  if (kind === "tab") return isPinnedRow(s.tabs[id]) && s.tabs[id]!.spaceId === spaceId;
  if (kind === "group") return !!s.groups[id]?.pinned && !s.groups[id]!.parentId && s.groups[id]!.spaceId === spaceId;
  return true;
};

export function arrangeLive(sequence: string[]) {
  const s = useBrowser.getState();
  const spaceId = sequence.flatMap((e) => live().folders[entryId(e, "live") ?? ""]?.spaceId ?? [])[0];
  arrangeFolders(liveAnchors(sequence.filter((e) => stillPinned(s, e, spaceId)), (e) => anchorKey(s, e)));
}

export function moveLiveFolder(windowId: string, folderId: string, delta: -1 | 1) {
  const folder = live().folders[folderId];
  if (!folder) return;
  const sequence = pinnedSequence(useBrowser.getState(), live().folders, live().folderOrder, windowId, folder.spaceId);
  const i = sequence.indexOf(entryKey("live", folderId));
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sequence.length) return;
  [sequence[i], sequence[j]] = [sequence[j]!, sequence[i]!];
  arrangeLive(sequence);
}

export function keepLiveAnchors(s: BrowserState, prev: BrowserState) {
  if (s.tabs === prev.tabs && s.groups === prev.groups && s.windows === prev.windows) return;
  const { folders, folderOrder } = live();
  for (const spaceId of new Set(folderOrder.map((id) => folders[id]?.spaceId))) {
    const windowId = spaceId && mainWindowFor(s, spaceId);
    const before = windowId ? prev.windows[windowId] : undefined;
    if (!spaceId || !windowId || !before) continue;
    const now = new Set(pinnedAreaKeys(s, s.windows[windowId]!, spaceId));
    const was = pinnedAreaKeys(prev, before, spaceId);
    const mine = foldersOf(folders, folderOrder, spaceId);
    if (!mine.some((f) => f.after && !now.has(f.after) && was.includes(f.after))) continue;
    const shown = withLiveFolders(was, was, mine).filter((e) => entryId(e, "live") !== null || now.has(e));
    arrangeFolders(liveAnchors(shown, (e) => e));
  }
}

useBrowser.subscribe(keepLiveAnchors);

export function usePinnedSequence(windowId: string, spaceId: string, off: boolean): string[] {
  const pinned = useBrowser((s) => (off ? NO_ENTRIES : sidebarEntries(s, windowId, spaceId).pinned));
  const keys = useBrowser(useShallow((s) => pinned.map((e) => anchorKey(s, e))));
  const incognito = useBrowser((s) => s.windows[windowId]?.kind === "private");
  const folders = useLive(useShallow((s) => (off || incognito ? NO_FOLDERS : foldersOf(s.folders, s.folderOrder, spaceId))));
  return useMemo(() => withLiveFolders(pinned, keys, folders), [pinned, keys, folders]);
}

const NO_ENTRIES: string[] = [];
const NO_FOLDERS: LiveFolder[] = [];
