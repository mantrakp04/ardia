import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { arrangeFolders, live, useLive } from "../../live/store";
import type { LiveFolder } from "../../live/types";
import { useBrowser, type BrowserState } from "../../store/browser";
import { sidebarEntries } from "./entries";

export const LIVE = "lf:";

export function anchorKey(s: Pick<BrowserState, "tabs" | "groups">, entry: string): string {
  const id = entry.slice(2);
  const x = entry.startsWith("g:") ? s.groups[id] : s.tabs[id];
  return `${entry.slice(0, 2)}${x?.pinKey ?? id}`;
}

export function withLiveFolders(entries: string[], keys: string[], folders: Pick<LiveFolder, "id" | "after">[]): string[] {
  if (!folders.length) return entries;
  const known = new Set(keys);
  const at = (after: string | null) => folders.filter((f) => f.after === after).map((f) => `${LIVE}${f.id}`);
  const out = at(null);
  entries.forEach((entry, i) => out.push(entry, ...at(keys[i]!)));
  for (const f of folders) if (f.after === undefined || (f.after !== null && !known.has(f.after))) out.push(`${LIVE}${f.id}`);
  return out;
}

export function liveAnchors(sequence: string[], keyOf: (entry: string) => string): { id: string; after: string | null }[] {
  let after: string | null = null;
  const out: { id: string; after: string | null }[] = [];
  for (const entry of sequence) {
    if (entry.startsWith(LIVE)) out.push({ id: entry.slice(LIVE.length), after });
    else after = keyOf(entry);
  }
  return out;
}

export function pinnedSequence(s: BrowserState, folders: Record<string, LiveFolder>, order: string[], windowId: string, profileId: string): string[] {
  const { pinned } = sidebarEntries(s, windowId, profileId);
  if (s.windows[windowId]?.incognito) return pinned;
  const mine = order.map((id) => folders[id]).filter((f): f is LiveFolder => f?.profileId === profileId);
  return withLiveFolders(pinned, pinned.map((e) => anchorKey(s, e)), mine);
}

export function arrangeLive(sequence: string[]) {
  const s = useBrowser.getState();
  arrangeFolders(liveAnchors(sequence, (e) => anchorKey(s, e)));
}

export function moveLiveFolder(windowId: string, folderId: string, delta: -1 | 1): boolean {
  const s = useBrowser.getState();
  const profileId = s.windows[windowId]?.profileId ?? "";
  const sequence = pinnedSequence(s, live().folders, live().folderOrder, windowId, profileId);
  const i = sequence.indexOf(`${LIVE}${folderId}`);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sequence.length) return false;
  [sequence[i], sequence[j]] = [sequence[j]!, sequence[i]!];
  arrangeLive(sequence);
  return true;
}

export function usePinnedSequence(windowId: string, profileId: string, off: boolean): string[] {
  const pinned = useBrowser((s) => (off ? NO_ENTRIES : sidebarEntries(s, windowId, profileId).pinned));
  const keys = useBrowser(useShallow((s) => pinned.map((e) => anchorKey(s, e))));
  const incognito = useBrowser((s) => !!s.windows[windowId]?.incognito);
  const folders = useLive(useShallow((s) => (off || incognito ? NO_FOLDERS : s.folderOrder.map((id) => s.folders[id]).filter((f): f is LiveFolder => f?.profileId === profileId))));
  return useMemo(() => withLiveFolders(pinned, keys, folders), [pinned, keys, folders]);
}

const NO_ENTRIES: string[] = [];
const NO_FOLDERS: LiveFolder[] = [];
