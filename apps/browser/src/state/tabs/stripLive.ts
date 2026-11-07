import { useShallow } from "zustand/react/shallow";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { menuSections } from "../app/menuSections";
import { activeTabId, viewTabIds } from "../browser/model";
import { useBrowser, type BrowserState } from "../browser/store";
import { folderNote, openLiveItem, statusText } from "../live/engine";
import { folderRows } from "../live/rows";
import { live, useLive } from "../live/store";
import type { LiveItem } from "../live/types";
import { entryId } from "../sidebar/entryKey";
import { runLiveFolderChoice } from "../sidebar/liveMenus";
import { pinnedSequence } from "../sidebar/pinnedOrder";

type LiveChoice = ChoiceItem<LiveItem>;

const NONE: string[] = [];

export function useStripLiveFolders(windowId: string, profileId: string): string[] {
  const folders = useLive((s) => s.folders);
  const order = useLive((s) => s.folderOrder);
  const any = order.some((id) => folders[id]?.profileId === profileId);
  return useBrowser(useShallow((s) => (any ? pinnedSequence(s, folders, order, windowId, profileId).flatMap((e) => entryId(e, "live") ?? []) : NONE)));
}

export const useLiveFolderShown = (windowId: string, profileId: string, folderId: string) =>
  useBrowser((s) => s.tabs[activeTabId(s, windowId, profileId) ?? ""]?.liveItem?.folderId === folderId);

const itemTab = (s: BrowserState, windowId: string, folderId: string, itemId: string) =>
  viewTabIds(s, windowId).find((id) => s.tabs[id]?.liveItem?.folderId === folderId && s.tabs[id]?.liveItem?.itemId === itemId);

export function liveStripMenuItems(s: BrowserState, windowId: string, folderId: string): LiveChoice[] {
  const l = live();
  const folder = l.folders[folderId];
  if (!folder) return [];
  const unread = new Set(l.unread[folderId] ?? []);
  const active = activeTabId(s, windowId);
  const itemChoice = (item: LiveItem): LiveChoice => ({
    value: item,
    title: item.title,
    symbol: unread.has(item.id) ? "circle.fill" : item.pr ? "arrow.triangle.pull" : "doc.text",
    checked: !!active && itemTab(s, windowId, folderId, item.id) === active,
  });
  const sections: LiveChoice[][] = [[]];
  for (const row of folderRows(folder, l.items[folderId] ?? [], {}, Infinity)) {
    if (row.kind === "header") sections.push([{ id: row.key, title: row.title, enabled: false }]);
    else if (row.kind === "item") sections.at(-1)!.push(itemChoice(row.item));
    else if (row.kind === "stack")
      sections.at(-1)!.push({ id: row.key, title: `${row.repo.split("/")[1] ?? row.repo} stack`, symbol: "square.stack.3d.up", children: row.items.map(itemChoice) });
  }
  const note = folderNote(l, folderId);
  if (note.kind !== "loading" && sections.every((section) => !section.length)) {
    const id = note.kind === "error" ? "settings" : note.kind === "hidden" ? "refresh" : "note";
    sections.push([{ id, title: note.text, enabled: id !== "note", ...(note.kind === "error" ? { symbol: "exclamationmark.triangle.fill" } : {}) }]);
  }
  return menuSections<LiveChoice>(...sections, [
    { id: "status", title: statusText(folderId), enabled: false },
    { id: "refresh", title: "Refresh", symbol: "arrow.clockwise", enabled: l.status[folderId]?.state !== "updating" },
    { id: "read", title: "Mark All as Read", enabled: unread.size > 0 },
  ]);
}

export async function openLiveStripMenu(windowId: string, folderId: string) {
  const choice = await chooseFromMenu<LiveItem, string>(liveStripMenuItems(useBrowser.getState(), windowId, folderId));
  if (choice === null) return;
  if (typeof choice === "object") openLiveItem(windowId, folderId, choice);
  else await runLiveFolderChoice(windowId, folderId, choice);
}
