import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { closeGroup, moveGroupToProfile, moveGroupToWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, isIncognitoProfile } from "../browser/model";
import { groupOf } from "../pins/tabGrouping";
import { hasOwnGroupIcon } from "../groups/groupIcons";
import type { GroupColor } from "../browser/types";
import { GROUP_COLOR_ORDER, GROUP_COLORS, NEUTRAL_GROUP_SWATCH, NO_GROUP_COLOR_SWATCH, nearestGroupColor } from "../groups/tokens";
import { copyUrls, openIconPicker, startRename } from "./actions";
import { toggleNewTabBar } from "../omnibox/newTabBar";
import { hintWhen, profileItems, sections, windowItems, withAlternate, type Destination } from "./menuParts";

type GroupChoice = Destination | { kind: "color"; color: GroupColor | null };

type GroupMenuItem = ChoiceItem<GroupChoice>;

const store = () => useBrowser.getState();

export function groupColorItems(current: GroupColor | null, siteColor: string | null | undefined): GroupMenuItem[] {
  const matched = siteColor ? nearestGroupColor(siteColor) : null;
  const color = (c: GroupColor | null) => ({ kind: "color" as const, color: c });
  return [
    { value: color("none"), title: "None", swatch: NO_GROUP_COLOR_SWATCH, checked: current === "none" },
    { value: color(null), title: "Neutral", swatch: NEUTRAL_GROUP_SWATCH.light, swatchDark: NEUTRAL_GROUP_SWATCH.dark, checked: !current },
    { value: color(matched), title: "Match Site Color", enabled: !!matched, swatch: matched ? GROUP_COLORS[matched].hex : undefined },
    { separator: true },
    ...GROUP_COLOR_ORDER.map((c) => ({ value: color(c), title: GROUP_COLORS[c].name, swatch: GROUP_COLORS[c].hex, checked: current === c })),
  ];
}

export function groupMenuItems(s: BrowserState, windowId: string, groupId: string): GroupMenuItem[] {
  const g = s.groups[groupId];
  if (!g) return [];
  const siteColor = g.tabIds.map((id) => s.live[id]?.themeColor).find(Boolean);
  const shown = groupOf(s, activeTabId(s, windowId))?.id === groupId;
  const incognito = isIncognitoProfile(g.profileId);
  return sections<GroupMenuItem>(
    g.parentId ? [] : [{ id: "pin", title: g.pinned ? "Unpin Group" : "Pin Group", symbol: g.pinned ? "pin.slash" : "pin" }],
    [
      { id: "newTab", title: "New Tab in Group", symbol: "plus.app", ...hintWhen(shown, "newTabInGroup", s) },
      { id: "nest", title: "New Nested Group" },
      { id: "duplicate", title: "Duplicate Group", symbol: "plus.square.on.square" },
    ],
    [
      { id: "moveToProfile", title: "Move to Profile", symbol: "person", enabled: !incognito, children: profileItems(s, (id) => id === g.profileId) },
      ...(g.pinned ? [] : [{ id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !incognito, children: windowItems(s, windowId) }]),
    ],
    [
      { id: "rename", title: "Rename…", symbol: "pencil" },
      { id: "icon", title: hasOwnGroupIcon(g.icon) ? "Change Icon…" : "Add Icon…", symbol: "photo" },
      { id: "color", title: "Color", symbol: "paintpalette", children: groupColorItems(g.color, siteColor) },
    ],
    withAlternate({ id: "copy", title: "Copy All Links", symbol: "link" }, { id: "copyMd", title: "Copy All Links as Markdown", symbol: "link" }, null),
    [
      { id: "ungroup", title: "Ungroup", symbol: "folder.badge.minus" },
      { id: "bookmarkBar", title: "Move to Bookmarks Bar", symbol: "bookmark" },
      { id: "close", title: "Close Group", symbol: "xmark", ...hintWhen(shown, "closeTabGroup", s) },
      { id: "delete", title: "Delete Group", symbol: "trash" },
    ],
  );
}

export async function openGroupMenu(windowId: string, groupId: string) {
  const choice = await chooseFromMenu(groupMenuItems(store(), windowId, groupId));
  if (choice) runGroupChoice(windowId, groupId, choice);
}

function sendGroup(groupId: string, to: GroupChoice) {
  if (to.kind === "color") store().updateGroup(groupId, { color: to.color });
  else if (to.kind === "profile") void moveGroupToProfile(groupId, to.profileId);
  else if (to.kind === "window") moveGroupToWindow(groupId, to.windowId);
}

function runGroupChoice(windowId: string, groupId: string, choice: string | GroupChoice) {
  const s = store();
  const g = s.groups[groupId];
  if (!g || g.windowId !== windowId) return;
  if (typeof choice !== "string") return sendGroup(groupId, choice);
  const target = { kind: "group" as const, id: groupId };
  if (choice === "rename") void startRename(windowId, target);
  else if (choice === "icon") void openIconPicker(windowId, target);
  else if (choice === "newTab") {
    if (toggleNewTabBar(windowId, { kind: "group", groupId })) return;
    const id = s.newTabInGroup(groupId);
    if (id) store().activate(id);
  } else if (choice === "nest") {
    const child = s.newNestedGroup(groupId);
    const tabId = store().groups[child]?.tabIds[0];
    if (tabId) store().activate(tabId);
    if (child) void startRename(windowId, { kind: "group", id: child });
  } else if (choice === "pin") s.moveGroup(groupId, { pinned: !g.pinned });
  else if (choice === "duplicate") s.duplicateGroup(groupId);
  else if (choice === "copy") copyUrls(g.tabIds, false);
  else if (choice === "copyMd") copyUrls(g.tabIds, true);
  else if (choice === "ungroup") s.ungroup(groupId);
  else if (choice === "bookmarkBar") s.moveGroupToBookmarksBar(groupId);
  else if (choice === "close") void closeGroup(groupId);
  else if (choice === "delete") s.deleteGroup(groupId);
}
