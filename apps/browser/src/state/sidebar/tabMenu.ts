import type { MenuItem } from "../../platform/menus";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { closeTab, moveTabsToProfile, moveTabToWindow, openWindow, toggleMute, toggleSiteMute } from "../browser/actions";
import { muteState, muteSymbol, muteTitle, siteMuteTitle } from "../tabs/mute";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, inPinnedContainer, isIncognitoProfile, pinnedSectionTitle, pinSection, togglePinTitle, viewTabIds, tabLayoutOf } from "../browser/model";
import { awayFromPin, selectedTabIds } from "../pins/organize";
import { groupOf } from "../pins/tabGrouping";
import { splitOf, splitRowPanes } from "../splits/splits";
import { openSplitPane } from "../splits/actions";
import type { Tab } from "../browser/types";
import { bookmarkTabs, copyUrls, editPinnedPage, newGroupWithSelection, openIconPicker, startRename } from "./actions";
import { isCalendarUrl } from "../live/meetings";
import { bookmarkTab } from "../bookmarks/actions";
import { calendarMenuItem, dismissNowMenuItems, runCalendarMenu } from "./liveMenus";
import { newFolderWithTab, removeFromFolder } from "./tileFolderUi";
import { togglePageEngine } from "../engines/actions";
import { canSwitchEngine, ENGINE_NAMES, otherEngine, tabEngine } from "../engines/engines";
import { bookmarkFolderItems, groupItems, hintWhen, profileItems, sections, windowItems, withAlternate, type Destination } from "./menuParts";
import { openMultiMenu } from "./multiTabMenu";
import { tileFolderOf } from "../pins/tileFolders";

const store = () => useBrowser.getState();

export function tabMenuFacts(s: BrowserState, windowId: string, tab: Tab) {
  const list = viewTabIds(s, windowId).filter((id) => !inPinnedContainer(s, id));
  const housed = inPinnedContainer(s, tab.id);
  const index = list.indexOf(tab.id);
  const split = splitOf(s, tab.id);
  return {
    housed,
    memberPin: housed && !tab.pin,
    section: pinSection(tab),
    above: housed || index < 0 ? [] : list.slice(0, index),
    below: housed || index < 0 ? [] : list.slice(index + 1),
    others: housed ? [] : list.filter((id) => id !== tab.id),
    group: groupOf(s, tab.id),
    split,
    splitRow: splitRowPanes(s, split).includes(tab.id),
    incognito: isIncognitoProfile(tab.profileId),
    across: tabLayoutOf(s, windowId) === "top",
    active: activeTabId(s, windowId) === tab.id,
  };
}

type Facts = ReturnType<typeof tabMenuFacts>;

function pinItems(s: BrowserState, tab: Tab, f: Facts): MenuItem[] {
  const toRows = `Move to ${pinnedSectionTitle(s, tab)}`;
  const editPinned: MenuItem[] = f.housed
    ? [
        {
          id: "pinnedPage",
          title: "Edit Pinned Page",
          children: [
            { id: "backToPin", title: "Back to Pinned URL", symbol: "arrow.uturn.backward", enabled: awayFromPin(tab), ...hintWhen(f.active, "returnToPinnedUrl", s) },
            { id: "replacePin", title: "Replace Pinned URL with Current", enabled: awayFromPin(tab) },
            { separator: true },
            { id: "editPin", title: "Edit Pinned URL…" },
          ],
        },
      ]
    : [];
  if (f.memberPin) return [{ id: "unpinMember", title: "Unpin", symbol: "pin.slash" }, ...editPinned];
  const row = f.section === "row";
  const toggle: MenuItem = { id: "pin", title: togglePinTitle(tab), symbol: tab.pin ? "pin.slash" : "pin", ...(row ? hintWhen(f.active, "togglePinnedRow", s) : {}) };
  const other: MenuItem[] = f.splitRow
    ? []
    : f.section === "none"
      ? [{ id: "pinRow", title: toRows, ...hintWhen(f.active, "togglePinnedRow", s) }]
      : f.section === "tile"
        ? [{ id: "pinRow", title: toRows }]
        : [{ id: "pinTile", title: "Move to Top Apps" }];
  return [toggle, ...other, ...editPinned];
}

function openItems(s: BrowserState, tab: Tab, f: Facts): MenuItem[] {
  const engine = canSwitchEngine(tab.url) ? ENGINE_NAMES[otherEngine(tabEngine(s, tab.id))] : null;
  return [
    ...(f.split
      ? [{ id: "unsplit", title: "Remove from Split View", symbol: "rectangle.split.2x1.slash" }]
      : f.section === "tile"
        ? []
        : [{ id: "split", title: "Open as Split", symbol: "rectangle.split.2x1", ...hintWhen(f.active, "openSplitPane", s) }]),
    { id: "duplicate", title: "Duplicate", symbol: "plus.square.on.square" },
    ...(f.housed ? [{ id: "newWindow", title: "Open in New Window", symbol: "macwindow.badge.plus", enabled: !!tab.url && !f.incognito }] : []),
    ...(engine ? [{ id: "engine", title: `Open in ${engine}` }] : []),
  ];
}

function calendarItems(tab: Tab): MenuItem[] {
  if (!tab.pin || !isCalendarUrl(tab.pinnedUrl ?? tab.url)) return [];
  return [...(pinSection(tab) === "tile" ? dismissNowMenuItems() : []), calendarMenuItem()];
}

type TabMenuItem = ChoiceItem<Destination>;

function organiseItems(s: BrowserState, windowId: string, tab: Tab, f: Facts): TabMenuItem[] {
  const groups = f.section === "tile" ? [] : groupItems(s, windowId, f.group?.id);
  const grouping: TabMenuItem[] =
    f.section === "tile"
      ? [tileFolderOf(tab) ? { id: "leaveFolder", title: "Remove from Folder", symbol: "folder.badge.minus" } : { id: "newFolder", title: "New Folder…", symbol: "folder.badge.plus" }]
      : [
          ...(f.memberPin
            ? []
            : f.group
              ? [{ id: "ungroupTab", title: "Remove from Group", symbol: "folder.badge.minus" }]
              : [{ id: "newGroup", title: "New Group with Tab", symbol: "folder.badge.plus", ...hintWhen(f.active, "newGroupWithTabs", s) }]),
          ...(groups.length ? [{ id: "moveToGroup", title: "Move to Group", symbol: "folder", children: groups }] : []),
        ];
  return [
    ...grouping,
    { id: "moveToProfile", title: "Move to Profile", symbol: "person", enabled: !f.incognito, children: profileItems(s, (id) => id === tab.profileId) },
    { id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !f.incognito, children: windowItems(s, windowId) },
  ];
}

function muteItems(s: BrowserState, tab: Tab): MenuItem[] {
  if (!tab.url) return [];
  const state = muteState(s, tab);
  const mute: MenuItem = { id: "mute", title: muteTitle(state), symbol: muteSymbol(state) };
  if (state === "site") return [mute];
  return withAlternate(mute, { id: "muteSite", title: siteMuteTitle(state), symbol: muteSymbol(null) }, null);
}

function closeItems(f: Facts): MenuItem[] {
  if (f.housed) return [];
  return [
    { id: "close", title: "Close", symbol: "xmark", ...hintWhen(f.active, "closeTab") },
    { id: "closeOthers", title: "Close Other Tabs", enabled: f.others.length > 0 },
    ...withAlternate(
      { id: "closeBelow", title: f.across ? "Close Tabs to the Right" : "Close Tabs Below", enabled: f.below.length > 0 },
      { id: "closeAbove", title: f.across ? "Close Tabs to the Left" : "Close Tabs Above", enabled: f.above.length > 0 },
      null,
    ),
  ];
}

export function tabMenuItems(s: BrowserState, windowId: string, tab: Tab, f: Facts = tabMenuFacts(s, windowId, tab)): TabMenuItem[] {
  return sections<TabMenuItem>(
    pinItems(s, tab, f),
    openItems(s, tab, f),
    calendarItems(tab),
    organiseItems(s, windowId, tab, f),
    [
      { id: "bookmark", title: "Add to Bookmarks…", symbol: "bookmark", enabled: !!tab.url, ...hintWhen(f.active, "bookmarkPage", s) },
      { id: "bookmarkTo", title: "Add Bookmark to Folder", enabled: !!tab.url, children: bookmarkFolderItems(s, windowId) },
    ],
    withAlternate(
      { id: "copy", title: "Copy Link", symbol: "link", enabled: !!tab.url },
      { id: "copyMd", title: "Copy Link as Markdown", symbol: "link", enabled: !!tab.url },
      f.active ? ["copyUrl", "copyUrlAsMarkdown"] : null,
      s,
    ),
    [
      { id: "rename", title: "Rename…", symbol: "pencil" },
      ...(tab.customTitle ? [{ id: "resetName", title: "Reset Name" }] : []),
      { id: "icon", title: "Change Icon…", symbol: "photo" },
      ...(tab.customIcon ? [{ id: "resetIcon", title: "Reset Icon" }] : []),
      ...muteItems(s, tab),
    ],
    closeItems(f),
  );
}

export async function openTabMenu(windowId: string, tab: Tab) {
  const s = store();
  const selected = selectedTabIds(s, windowId);
  if (selected.length > 1 && selected.includes(tab.id)) return openMultiMenu(windowId, selected);
  if (s.selection[windowId]?.length) s.setSelection(windowId, []);
  const f = tabMenuFacts(store(), windowId, tab);
  const choice = await chooseFromMenu(tabMenuItems(store(), windowId, tab, f));
  const now = store().tabs[tab.id];
  if (!choice || now?.windowId !== windowId) return;
  const here = (ids: string[]) => ids.filter((id) => store().tabs[id]?.windowId === windowId);
  runTabChoice(windowId, now, { ...f, others: here(f.others), above: here(f.above), below: here(f.below) }, choice);
}

function openAsSplit(windowId: string, tabId: string, wasActive: boolean) {
  const front = activeTabId(store(), windowId);
  if (wasActive || front === tabId) openSplitPane(windowId, { anchorTabId: tabId });
  else if (front) openSplitPane(windowId, { tabId, anchorTabId: front, side: "right" });
}

function sendTab(windowId: string, tabId: string, to: Destination) {
  if (to.kind === "group") store().placeTabs([tabId], { pinned: false, groupId: to.groupId });
  else if (to.kind === "profile") void moveTabsToProfile([tabId], to.profileId);
  else if (to.kind === "window") moveTabToWindow(tabId, to.windowId);
  else void bookmarkTabs(windowId, [tabId], to);
}

function runTabChoice(windowId: string, tab: Tab, f: Facts, choice: string | Destination) {
  if (typeof choice !== "string") return sendTab(windowId, tab.id, choice);
  const s = store();
  const t = { kind: "tab" as const, id: tab.id };
  if (runCalendarMenu(choice)) return;
  if (choice === "backToPin") s.returnToPinnedUrl(tab.id);
  else if (choice === "replacePin") s.setPinnedUrl(tab.id);
  else if (choice === "editPin") void editPinnedPage(windowId, tab.id);
  else if (choice === "rename") void startRename(windowId, t);
  else if (choice === "resetName") s.updateTab(tab.id, { customTitle: null });
  else if (choice === "icon") void openIconPicker(windowId, t);
  else if (choice === "resetIcon") s.updateTab(tab.id, { customIcon: null });
  else if (choice === "pin") s.togglePin(tab.id);
  else if (choice === "unpinMember") s.placeTabs([tab.id], { pinned: false, groupId: null });
  else if (choice === "pinTile") s.pinTabs([tab.id], true, false);
  else if (choice === "pinRow") s.pinTabs([tab.id], true, true);
  else if (choice === "split") openAsSplit(windowId, tab.id, f.active);
  else if (choice === "newWindow") openWindow({ profileId: tab.profileId, url: tab.url });
  else if (choice === "newFolder") newFolderWithTab(windowId, tab.id);
  else if (choice === "leaveFolder") removeFromFolder(tab.id);
  else if (choice === "duplicate") s.duplicateTab(tab.id);
  else if (choice === "ungroupTab") s.removeTabsFromGroup([tab.id]);
  else if (choice === "newGroup") newGroupWithSelection(windowId, [tab.id]);
  else if (choice === "unsplit") s.removeTabFromSplit(tab.id);
  else if (choice === "mute") toggleMute(tab.id);
  else if (choice === "muteSite") toggleSiteMute(tab.id);
  else if (choice === "engine") void togglePageEngine(tab.id);
  else if (choice === "copy") copyUrls([tab.id], false);
  else if (choice === "copyMd") copyUrls([tab.id], true);
  else if (choice === "bookmark") bookmarkTab(windowId, tab.id);
  else if (choice === "close") void closeTab(tab.id);
  else if (choice === "closeOthers") s.closeTabs(f.others);
  else if (choice === "closeAbove") s.closeTabs(f.above);
  else if (choice === "closeBelow") s.closeTabs(f.below);
}
