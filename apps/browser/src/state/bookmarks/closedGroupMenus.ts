import { displayUrl } from "@ardia/core";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { useBrowser } from "../browser/store";
import type { ClosedGroup } from "../browser/types";
import { resolveFavicon } from "../favicons/favicons";
import {
  closedGroupsOnBarForProfile, deleteClosedGroup, openClosedGroupTab,
  reopenClosedGroup, reopenClosedGroupInNewWindow, unpinClosedGroup,
} from "../groups/closedGroups";

type GroupChoice = { entryId: string; action: "open" | "newWindow" | "unpin" | "delete" } | { entryId: string; action: "tab"; index: number };

export function closedGroupMenuItems(entry: ClosedGroup): ChoiceItem<GroupChoice>[] {
  const value = (action: "open" | "newWindow" | "unpin" | "delete"): GroupChoice => ({ entryId: entry.id, action });
  return [
    { value: value("open"), title: "Open Group", symbol: "arrow.up.forward.app" },
    { value: value("newWindow"), title: "Open Group in New Window", symbol: "macwindow.badge.plus" },
    { value: value("unpin"), title: "Unpin Group from Bookmarks Bar", symbol: "pin.slash" },
    { value: value("delete"), title: "Delete Group", symbol: "trash" },
    { separator: true },
    { id: "tabs", title: "Tabs in Group", enabled: false },
    ...entry.tabs.map((tab, index) => ({
      value: { entryId: entry.id, action: "tab" as const, index },
      title: tab.customTitle || tab.title || displayUrl(tab.url) || "New Tab",
      symbol: "globe", favicon: resolveFavicon(tab.url, tab.favicon, tab.profileId)?.uri ?? "",
      enabled: !!tab.url,
    })),
  ];
}

export async function openClosedGroupMenu(windowId: string, entryId: string) {
  return openMenu(windowId, [entryId], false);
}

export async function openClosedGroupsOverflowMenu(windowId: string, entryIds: string[]) {
  return openMenu(windowId, entryIds, true);
}

async function openMenu(windowId: string, entryIds: string[], overflow: boolean) {
  const s = useBrowser.getState();
  const window = s.windows[windowId];
  if (!window || window.kind !== "main") return;
  const profileId = window.profileId;
  const entries = closedGroupsOnBarForProfile(s, profileId).filter((entry) => entryIds.includes(entry.id));
  if (!entries.length) return;
  const items: ChoiceItem<GroupChoice>[] = overflow
    ? entries.map((entry) => ({
      id: entry.id, title: `${entry.group.name || "Untitled group"} (${entry.tabs.length} tabs)`,
      children: closedGroupMenuItems(entry),
    }))
    : closedGroupMenuItems(entries[0]!);
  const choice = await chooseFromMenu(items);
  const current = useBrowser.getState();
  const target = current.windows[windowId];
  if (!choice || typeof choice === "string" || !target || target.kind !== "main" || target.profileId !== profileId) return;
  if (!closedGroupsOnBarForProfile(current, profileId).some((entry) => entry.id === choice.entryId)) return;
  if (choice.action === "open") reopenClosedGroup(choice.entryId, windowId);
  else if (choice.action === "newWindow") reopenClosedGroupInNewWindow(choice.entryId, profileId);
  else if (choice.action === "unpin") unpinClosedGroup(choice.entryId, profileId);
  else if (choice.action === "delete") deleteClosedGroup(choice.entryId, profileId);
  else if (choice.action === "tab") openClosedGroupTab(choice.entryId, choice.index, windowId);
}
