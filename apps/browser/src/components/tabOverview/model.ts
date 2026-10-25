import type { BrowserState } from "../../store/browser";
import { matchesQuery } from "../../lib/tabOverviewFilter";
import { viewTabIds } from "../../store/model";
import { splitRowPanes } from "../../store/splits";
import { groupEntries, sidebarEntries } from "../sidebar/entries";

export type OverviewItem =
  | { kind: "tab"; id: string }
  | { kind: "folder"; key: string; name: string; icon: string | null; tabIds: string[] };

export type OverviewSection = { title: string; items: OverviewItem[] };

function entryTabs(s: BrowserState, entry: string): string[] {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return groupEntries(s, id).flatMap((e) => entryTabs(s, e));
  if (entry.startsWith("s:")) return splitRowPanes(s, s.splits[id]);
  return s.tabs[id] ? [id] : [];
}

function entryItems(s: BrowserState, entry: string): OverviewItem[] {
  if (!entry.startsWith("g:")) return entryTabs(s, entry).map((id) => ({ kind: "tab", id }));
  const group = s.groups[entry.slice(2)];
  const tabIds = entryTabs(s, entry);
  if (!group || !tabIds.length) return [];
  return [{ kind: "folder", key: entry, name: group.name || "Folder", icon: group.icon, tabIds }];
}

function tileItems(s: BrowserState, tiles: string[]): OverviewItem[] {
  const out: OverviewItem[] = [];
  const folders = new Map<string, Extract<OverviewItem, { kind: "folder" }>>();
  for (const id of tiles) {
    const folder = s.tabs[id]?.tileFolder;
    if (!folder) {
      out.push({ kind: "tab", id });
      continue;
    }
    const existing = folders.get(folder.id);
    if (existing) existing.tabIds.push(id);
    else {
      const item = { kind: "folder" as const, key: `f:${folder.id}`, name: folder.name || "Folder", icon: null, tabIds: [id] };
      folders.set(folder.id, item);
      out.push(item);
    }
  }
  return out;
}

export function overviewSections(s: BrowserState, windowId: string): OverviewSection[] {
  const { tiles, pinned, list } = sidebarEntries(s, windowId);
  const pinnedItems = [...tileItems(s, tiles), ...pinned.flatMap((e) => entryItems(s, e))];
  return [
    { title: "Pinned Folders", items: pinnedItems.filter((item) => item.kind === "folder") },
    { title: "Pinned", items: pinnedItems.filter((item) => item.kind === "tab") },
    { title: "Open", items: [...list.flatMap((e) => entryItems(s, e)), ...liveItems(s, windowId)] },
  ].filter((section) => section.items.length);
}

function liveItems(s: BrowserState, windowId: string): OverviewItem[] {
  return viewTabIds(s, windowId)
    .filter((id) => s.tabs[id]?.liveItem && !s.tabs[id]!.pinned)
    .map((id) => ({ kind: "tab", id }));
}

export function filterSections(
  sections: OverviewSection[],
  matches: (tabId: string) => boolean,
  query: string,
): OverviewSection[] {
  if (!query.trim()) return sections;
  return sections
    .map((section) => ({
      ...section,
      items: section.items.flatMap((item): OverviewItem[] => {
        if (item.kind === "tab") return matches(item.id) ? [item] : [];
        if (matchesQuery(item.name, query)) return [item];
        const tabIds = item.tabIds.filter(matches);
        return tabIds.length ? [{ ...item, tabIds }] : [];
      }),
    }))
    .filter((section) => section.items.length);
}
