import { chooseFromMenu } from "../app/menuChoice";
import { switchToTab } from "../browser/actions";
import { menuShortcut } from "../commands/commandShortcuts";
import { useBrowser } from "../browser/store";
import { plural, tabTitle, viewTabIds } from "../browser/model";
import { cleanedTabsFor, keptDeletedGroups } from "../pins/closedTabs";
import { allMuted, muteAll } from "./actions";
import { openSyncedTab, syncedDevicesMenuItem } from "../sync/menu";
import { setSidebarUi } from "./sidebarUi";
import { closeAllTabs } from "./clearTabs";
import { DAILY_CLEAN_UP_MINUTES } from "../settings/cleanUpAfter";
import { sep } from "./menuParts";

export { openTabMenu } from "./tabMenu";
export { openGroupMenu } from "./groupMenu";
export { openSidebarMenu } from "./sidebarMenu";

const store = () => useBrowser.getState();

type OverflowChoice = { open: string } | { restore: string } | { cleaned: string };

export async function openOverflowMenu(windowId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w) return;
  const muted = allMuted(windowId);
  const open = viewTabIds(s, windowId).map((id) => s.tabs[id]!);
  const closed = [
    ...s.closedTabs
      .filter((c) => c.tab.profileId === w.profileId)
      .map((c) => ({ value: { restore: c.id }, title: tabTitle(c.tab), symbol: "clock.arrow.circlepath", at: c.closedAt })),
    ...s.closedGroups.map((c) => ({ value: { restore: c.id }, title: `${c.group.name} (${plural(c.tabs.length, "Tab")})`, symbol: "rectangle.stack", at: c.closedAt })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 15)
    .map(({ at: _, ...item }) => item);
  const allCleaned = cleanedTabsFor(s, windowId);
  const cleaned = [...allCleaned].reverse().slice(0, 20);
  const deleted = keptDeletedGroups(s.deletedGroups)
    .reverse()
    .map((c) => ({ value: { restore: c.id }, title: `${c.group.name} (${plural(c.tabs.length, "Tab")})`, symbol: "trash" }));
  const daily = s.settings.cleanUpInactiveTabsAfterMinutes !== null;
  const synced = syncedDevicesMenuItem(w.profileId);
  const choice = await chooseFromMenu<OverflowChoice, string>([
    { id: "search", title: "Search Tabs…", symbol: "magnifyingglass", ...menuShortcut("searchTabs") },
    sep,
    {
      id: "open",
      title: "Open Tabs",
      symbol: "square.stack",
      enabled: open.length > 0,
      children: open.map((t) => ({ value: { open: t.id }, title: tabTitle(t), checked: w.activeTabIds[w.profileId] === t.id })),
    },
    ...(synced ? [synced] : []),
    { id: "closed", title: "Recently Closed", symbol: "clock.arrow.circlepath", enabled: closed.length > 0, children: closed.length ? closed : [{ id: "none", title: "Empty", enabled: false }] },
    {
      id: "cleaned",
      title: "Recently Cleaned",
      symbol: "wand.and.stars",
      enabled: cleaned.length > 0,
      children: cleaned.length
        ? [
            ...cleaned.map((c) => ({ value: { cleaned: c.id }, title: tabTitle(c.tab) })),
            sep,
            { id: "restoreAll", title: `Restore ${plural(allCleaned.length, "Tab")}` },
          ]
        : [{ id: "none", title: "Empty", enabled: false }],
    },
    ...(deleted.length ? [{ id: "deleted", title: "Recently Deleted Groups", symbol: "trash", children: deleted }] : []),
    sep,
    { id: "clean", title: "Clean Up Tabs", symbol: "wand.and.stars", ...menuShortcut("cleanUpTabs") },
    { id: "daily", title: "Clean Up Daily", checked: daily },
    sep,
    { id: "mute", title: muted ? "Unmute All Tabs" : "Mute All Tabs", symbol: muted ? "speaker.wave.2" : "speaker.slash" },
    { id: "closeAll", title: "Close All Tabs", symbol: "xmark", ...menuShortcut("closeAllTabs") },
  ]);
  if (!choice) return;
  if (typeof choice !== "string") {
    if ("open" in choice) switchToTab(choice.open);
    else if ("restore" in choice) s.restoreClosed(choice.restore, windowId);
    else s.restoreCleaned(choice.cleaned, windowId);
  } else if (choice === "search") setSidebarUi({ searchTabs: windowId });
  else if (openSyncedTab(choice, windowId, w.profileId)) return;
  else if (choice === "restoreAll") s.restoreCleaned(undefined, windowId);
  else if (choice === "clean") s.cleanUpTabs(windowId);
  else if (choice === "daily") s.updateSettings({ cleanUpInactiveTabsAfterMinutes: daily ? null : DAILY_CLEAN_UP_MINUTES });
  else if (choice === "mute") muteAll(windowId, !muted);
  else if (choice === "closeAll") closeAllTabs(windowId);
}
