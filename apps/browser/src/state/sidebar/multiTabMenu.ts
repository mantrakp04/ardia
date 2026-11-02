import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { moveTabsToProfile, switchToTab } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { inPinnedContainer, isIncognitoProfile, isPinnedRow, pinnedSectionTitle, pinSection, viewTabIds } from "../browser/model";
import { groupOf } from "../pins/tabGrouping";
import { bookmarkTabs, copyUrls, newGroupWithSelection } from "./actions";
import { bookmarkFolderItems, groupItems, hintWhen, profileItems, sections, windowItems, withAlternate, type Destination } from "./menuParts";

const store = () => useBrowser.getState();

export function multiTabMenuFacts(s: BrowserState, windowId: string, ids: string[]) {
  const tabs = ids.map((id) => s.tabs[id]!);
  const chosen = new Set(ids);
  return {
    tabs,
    allPinned: tabs.every((t) => t.pin),
    allTiles: tabs.every((t) => pinSection(t) === "tile"),
    incognito: tabs.some((t) => isIncognitoProfile(t.profileId)),
    others: viewTabIds(s, windowId).filter((id) => !chosen.has(id) && !inPinnedContainer(s, id)),
  };
}

type Facts = ReturnType<typeof multiTabMenuFacts>;

export function multiTabMenuItems(s: BrowserState, windowId: string, ids: string[], f: Facts = multiTabMenuFacts(s, windowId, ids)): ChoiceItem<Destination>[] {
  const n = ids.length;
  const groups = groupItems(s, windowId, undefined);
  return sections<ChoiceItem<Destination>>(
    [
      { id: "pin", title: f.allPinned ? `Unpin ${n} Tabs` : `Move ${n} Tabs to Top Apps`, symbol: f.allPinned ? "pin.slash" : "pin" },
      ...(f.tabs.every(isPinnedRow) ? [] : [{ id: "pinRows", title: `Move ${n} Tabs to ${pinnedSectionTitle(s, f.tabs[0])}` }]),
    ],
    [{ id: "duplicate", title: `Duplicate ${n} Tabs`, symbol: "plus.square.on.square" }],
    [
      { id: "newGroup", title: `New Group with ${n} Tabs`, symbol: "folder.badge.plus", enabled: !f.allTiles, ...hintWhen(!f.allTiles, "newGroupWithTabs", s) },
      ...(f.tabs.some((t) => groupOf(s, t.id)) ? [{ id: "ungroup", title: "Remove from Group", symbol: "folder.badge.minus" }] : []),
      ...(groups.length ? [{ id: "moveToGroup", title: "Move to Group", symbol: "folder", children: groups }] : []),
      {
        id: "moveToProfile",
        title: `Move ${n} Tabs to Profile`,
        symbol: "person",
        enabled: !f.incognito,
        children: profileItems(s, (id) => f.tabs.every((t) => t.profileId === id)),
      },
      { id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !f.incognito, children: windowItems(s, windowId) },
    ],
    [
      { id: "bar", title: `Add ${n} Tabs to Bookmarks Bar`, symbol: "bookmark" },
      { id: "bookmarkTo", title: `Add ${n} Tabs to Bookmarks Folder`, children: bookmarkFolderItems(s, windowId) },
    ],
    withAlternate({ id: "copy", title: `Copy ${n} Links`, symbol: "link" }, { id: "copyMd", title: `Copy ${n} Links as Markdown`, symbol: "link" }, null),
    [
      { id: "close", title: `Close ${n} Tabs`, symbol: "xmark" },
      { id: "closeOthers", title: "Close Other Tabs", enabled: f.others.length > 0 },
    ],
  );
}

function sendTabs(windowId: string, ids: string[], profileId: string, to: Destination) {
  if (to.kind === "group") store().placeTabs(ids, { pinned: false, groupId: to.groupId });
  else if (to.kind === "profile") void moveTabsToProfile(ids, to.profileId);
  else if (to.kind === "window") {
    const target = store().moveTabsToWindow(ids, to.windowId);
    if (target) switchToTab(store().windows[target]?.activeTabIds[profileId] ?? ids[0]!);
  } else void bookmarkTabs(windowId, ids, to);
}

export async function openMultiMenu(windowId: string, shown: string[]) {
  const f = multiTabMenuFacts(store(), windowId, shown);
  const choice = await chooseFromMenu(multiTabMenuItems(store(), windowId, shown, f));
  const s = store();
  const here = (list: string[]) => list.filter((id) => s.tabs[id]?.windowId === windowId);
  const ids = here(shown);
  if (!choice || !ids.length) return;
  if (typeof choice !== "string") sendTabs(windowId, ids, f.tabs[0]!.profileId, choice);
  else if (choice === "pin") s.pinTabs(ids, !f.allPinned);
  else if (choice === "pinRows") s.pinTabs(ids, true, true);
  else if (choice === "duplicate") ids.forEach((id) => store().duplicateTab(id));
  else if (choice === "newGroup") newGroupWithSelection(windowId, ids);
  else if (choice === "ungroup") s.removeTabsFromGroup(ids);
  else if (choice === "copy") copyUrls(ids, false);
  else if (choice === "copyMd") copyUrls(ids, true);
  else if (choice === "bar") void bookmarkTabs(windowId, ids, { kind: "folder", parentId: undefined });
  else if (choice === "close") s.closeTabs(ids);
  else if (choice === "closeOthers") s.closeTabs(here(f.others));
  if (choice !== "copy" && choice !== "copyMd") store().setSelection(windowId, []);
}
