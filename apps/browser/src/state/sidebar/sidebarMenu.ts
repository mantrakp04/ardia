import { showMenu, type MenuItem } from "../../platform/menus";
import { tabLayoutOf } from "../browser/model";
import { switchProfile } from "../browser/actions";
import { requestCreateProfile } from "../profiles/createProfileRequest";
import { useBrowser, type BrowserState } from "../browser/store";
import { menuShortcut } from "../commands/commandShortcuts";
import { bookmarkAllTabs } from "../bookmarks/actions";
import { toggleNewTabBar } from "../omnibox/newTabBar";
import { newGroupWithSelection } from "./actions";
import { closeAllTabs } from "./clearTabs";
import { lastClosedEntry } from "../windows/reopenClosed";
import { newLiveFolderMenuItem, runNewLiveFolder } from "./liveMenus";
import { sections } from "./menuParts";
import { pinnedFoldMenuItem, runPinnedFold } from "./pinnedFold";

const store = () => useBrowser.getState();

export function sidebarMenuItems(s: BrowserState, windowId: string): MenuItem[] {
  const w = s.windows[windowId];
  return sections(
    [
      { id: "newTab", title: "New Tab", symbol: "plus.app", ...menuShortcut("newTab", s) },
      { id: "reopen", title: "Reopen Closed Tab", enabled: !!lastClosedEntry(s, windowId), ...menuShortcut("reopenClosedTab", s) },
    ],
    [{ id: "newGroup", title: "New Group", symbol: "folder.badge.plus" }, newLiveFolderMenuItem()],
    [{ id: "newProfile", title: "New Profile…", symbol: "plus" }],
    [{ id: "bookmarkAll", title: "Bookmark All Tabs…", symbol: "bookmark", ...menuShortcut("bookmarkAllTabs", s) }],
    [
      ...pinnedFoldMenuItem(s, windowId),
      { id: "tabLayout", title: "Show Tabs in Sidebar", symbol: "sidebar.left", checked: tabLayoutOf(s, windowId) === "sidebar", ...menuShortcut("toggleTabLayout", s) },
      { id: "autoHide", title: "Auto-Hide Tabs", checked: !!w && !w.sidebarOpen, ...menuShortcut("toggleSidebar", s) },
    ],
    [{ id: "closeAll", title: "Close All Tabs", symbol: "xmark", ...menuShortcut("closeAllTabs", s) }],
  );
}

export async function openSidebarMenu(windowId: string) {
  const choice = await showMenu(sidebarMenuItems(store(), windowId));
  if (!choice || runNewLiveFolder(windowId, choice) || runPinnedFold(windowId, choice)) return;
  const s = store();
  if (choice === "newTab") {
    if (!toggleNewTabBar(windowId)) s.newTab(windowId, { newTabCommand: true });
  } else if (choice === "reopen") s.reopenClosed(windowId);
  else if (choice === "newGroup") {
    const id = s.newTab(windowId);
    if (id) newGroupWithSelection(windowId, [id]);
  } else if (choice === "newProfile") void requestCreateProfile(windowId).then((id) => id && switchProfile(windowId, id));
  else if (choice === "bookmarkAll") bookmarkAllTabs(windowId);
  else if (choice === "tabLayout") s.toggleTabLayout(windowId);
  else if (choice === "autoHide") s.toggleSidebar(windowId);
  else if (choice === "closeAll") closeAllTabs(windowId);
}
