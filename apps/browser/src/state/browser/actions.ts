import { listExtensions } from "../../platform/extensions";
import { stepPager } from "../../platform/pager";
import { confirm } from "../../platform/dialogs";
import { focusWindow } from "../../platform/windows";
import { showMenu, type MenuItem } from "../../platform/menus";
import { pageToProfile } from "../windows/profilePager";
import { profileNames, requestCreateProfile, type CreateProfilePreset } from "../profiles/createProfileRequest";
import { useBrowser, type CreateWindowOptions } from "./store";
import { rootOf } from "../groups/groups";
import { closesWindow, engineProfile, isIncognitoProfile, plural, resolveWindowId } from "./model";
import { leavesEmptyWindow } from "../omnibox/newTabBarPolicy";
import { groupLabel } from "../pins/organize";
import { engineIdOf, sharingProfiles } from "../profiles/profiles";
import { closeWindowAnimated } from "../windows/closeAnimated";
import { applyHeldReports } from "../../platform/nativeEvents";
import { webviews } from "../../platform/webviews";
import { closeWindowDialog } from "../windows/windowClose";
import { menuCommandAlternate, menuShortcut } from "../commands/commandShortcuts";
import { openSettings } from "../settings/settingsWindows";
import { profileAccentOf } from "../profiles/looks";

const store = () => useBrowser.getState();

export function focus(windowId: string) {
  store().setFocusedWindow(windowId);
  void focusWindow(windowId);
}

export function openWindow(options?: CreateWindowOptions): string {
  return store().createWindow(options);
}

export function switchToTab(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().activate(tabId);
  if (tab.windowId !== store().ui.focusedWindowId) focus(tab.windowId);
}

export async function closeTab(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  const last = closesWindow(s, tabId) && !leavesEmptyWindow(s, tabId);
  if (last && s.settings.warnBeforeClosingLastTab && !w.incognito) {
    const { confirmed, suppressed } = await confirm({ ...closeWindowDialog(w.id), suppression: "Don’t ask me again", windowId: w.id });
    if (suppressed) store().updateSettings({ warnBeforeClosingLastTab: false });
    if (!confirmed) return;
    applyHeldReports();
  }
  const now = store();
  const closesItsWindow = now.tabs[tabId]?.windowId === w.id && now.peeks[w.id]?.tabId !== tabId && closesWindow(now, tabId) && !leavesEmptyWindow(now, tabId);
  if (last && closesItsWindow) return closeWindowAnimated(w.id);
  store().closeTab(tabId);
}

export async function closeGroup(groupId: string) {
  const s = store();
  const group = s.groups[groupId];
  const w = group && s.windows[group.windowId];
  if (!group || !w) return;
  if (s.settings.warnBeforeClosingTabGroup && !rootOf(s.groups, groupId)?.pinned) {
    const tabs = plural(group.tabIds.length, "tab");
    const { confirmed, suppressed } = await confirm({
      title: `Close “${groupLabel(s, group)}”?`,
      message: w.incognito ? `Its ${tabs} close with it.` : `Its ${tabs} close with it. History › Recently Closed Groups brings it back.`,
      confirmTitle: "Close Group",
      suppression: "Don’t ask me again",
      windowId: w.id,
    });
    if (suppressed) store().updateSettings({ warnBeforeClosingTabGroup: false });
    if (!confirmed) return;
    applyHeldReports();
  }
  if (store().groups[groupId]) store().closeGroup(groupId);
}

export function toggleMute(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().setSiteMuted(tabId, !tab.muted);
  void webviews.get(tabId)?.setMuted(!tab.muted);
}

export function createProfile(windowId?: string, preset?: CreateProfilePreset): Promise<string | null> {
  return requestCreateProfile(windowId, preset);
}

export async function deleteProfile(profileId: string, windowId?: string) {
  const s = store();
  const profile = s.profiles[profileId];
  if (!profile || s.profileOrder.length <= 1) return;
  const sharing = sharingProfiles(s, profileId).map((id) => s.profiles[id]!.name);
  const { confirmed } = await confirm({
    title: `Delete “${profile.name}”?`,
    message: sharing.length
      ? `Its tabs will be closed. Its cookies, passwords, extensions, bookmarks and history stay with ${profileNames(sharing)}, which share them.`
      : `All data associated with this Profile will be removed. This action cannot be undone.${engineIdOf(profile) === "" ? await keptExtensionsNote() : ""}`,
    confirmTitle: "Delete Profile",
    destructive: true,
    windowId,
  });
  if (!confirmed) return;
  store().deleteProfile(profileId);
}

async function keptExtensionsNote(): Promise<string> {
  const names = await listExtensions("").then(
    (list) => list.filter((e) => e.mayModify).map((e) => e.name),
    () => null,
  );
  if (names && !names.length) return "";
  return names ? ` Its extensions (${profileNames(names)}) stay installed on this Mac, turned off.` : " Its extensions stay installed on this Mac, turned off.";
}

export async function moveTabToProfile(tabId: string, target: string) {
  const tab = store().tabs[tabId];
  if (!tab || isIncognitoProfile(tab.profileId)) return;
  const profileId = target === "new" ? await createProfile(tab.windowId) : target;
  if (!profileId || profileId === tab.profileId) return;
  const shared = engineProfile(profileId) === engineProfile(tab.profileId);
  if (store().settings.warnBeforeMovingTabsToProfile && !shared) {
    const { confirmed, suppressed } = await confirm({
      title: "Move Tab to Profile?",
      message: "Moving tabs between profiles could result in some data being lost.",
      confirmTitle: "Move Tab",
      suppression: "Don't warn me again",
      windowId: tab.windowId,
    });
    if (suppressed) store().updateSettings({ warnBeforeMovingTabsToProfile: false });
    if (!confirmed) return;
  }
  store().moveTabToProfile(tabId, profileId);
}

export function moveTabToWindow(tabId: string, target: string) {
  const windowId = store().moveTabsToWindow([tabId], target === "new" ? null : target);
  if (windowId) focus(windowId);
}

export function switchProfile(windowId: string, profileId: string, animated = false) {
  if (animated) pageToProfile(windowId, profileId);
  else store().switchProfile(windowId, profileId);
}

export function cycleProfile(windowId: string, delta: 1 | -1) {
  if (!cycleTarget(windowId, delta)) return;
  void stepPager(windowId, delta, true, store().profileOrder.join("\n")).then((ok) => ok || cycleFromStore(windowId, delta));
}

function cycleFromStore(windowId: string, delta: 1 | -1) {
  const target = cycleTarget(windowId, delta);
  if (target) switchProfile(windowId, target, true);
}

function cycleTarget(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.incognito || s.profileOrder.length < 2) return null;
  const i = s.profileOrder.indexOf(w.profileId);
  return s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!;
}

export function openUrls(urls: string[], windowId?: string | null) {
  let target = resolveWindowId(store(), windowId);
  for (const url of urls) {
    if (!target || store().windows[target]?.incognito) target = openWindow({ url });
    else store().newTab(target, { url });
  }
}

export async function openProfileMenu(windowId: string) {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.profileId;
  const items: MenuItem[] = [
    ...s.profileOrder.flatMap((id): MenuItem[] => {
      const profile = s.profiles[id]!;
      const swatch = profileAccentOf(profile);
      const shortcut = menuShortcut(`switchProfile:${id}`, s);
      const alternate = menuCommandAlternate(`switchProfile:${id}`, s);
      const switchItem: MenuItem = { id: `switch:${id}`, title: profile.name, checked: id === current, swatch, ...shortcut, modifiers: shortcut.modifiers ?? [] };
      if (!alternate) return [switchItem];
      return [switchItem, { id: `window:${id}`, title: `${profile.name} ↗`, alternate: true, swatch, ...alternate }];
    }),
    { separator: true },
    { id: "new", title: "New Profile", symbol: "plus" },
    { id: "edit", title: "Edit Profiles…", symbol: "pencil" },
  ];
  const choice = await showMenu(items);
  if (!choice) return;
  if (choice.startsWith("switch:")) switchProfile(windowId, choice.slice("switch:".length), true);
  else if (choice.startsWith("window:")) openWindow({ profileId: choice.slice("window:".length) });
  else if (choice === "new") {
    const id = await createProfile(windowId);
    if (id) switchProfile(windowId, id);
  } else if (choice === "edit") openSettings("profiles", current);
}
