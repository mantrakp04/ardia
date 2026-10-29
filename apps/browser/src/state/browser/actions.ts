import { listExtensions } from "../../platform/extensions";
import { stepPager } from "../../platform/pager";
import { confirm } from "../../platform/dialogs";
import { focusWindow } from "../../platform/windows";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { pageToProfile } from "../windows/profilePager";
import { profileNames, requestCreateProfile } from "../profiles/createProfileRequest";
import { storeAction, useBrowser } from "./store";
import { rootOf } from "../groups/groups";
import { closesWindow, engineProfile, isIncognitoProfile, plural, resolveWindowId } from "./model";
import { leavesEmptyWindow } from "../omnibox/newTabBarPolicy";
import { groupLabel } from "../pins/tabGrouping";
import { sharingProfiles } from "../profiles/profiles";
import { closeWindowAnimated } from "../windows/closeAnimated";
import { applyHeldReports } from "../../platform/nativeEvents";
import { closeWindowDialog } from "../windows/windowClose";
import { menuCommandAlternate, menuShortcut } from "../commands/commandShortcuts";
import { openSettings } from "../settings/settingsWindows";
import { profileAccentOf } from "../profiles/looks";
import { isSiteMuted } from "../tabs/mute";
import { focusedWindowOf } from "../windows/ui";

const store = () => useBrowser.getState();

export function focus(windowId: string) {
  store().setFocusedWindow(windowId);
  void focusWindow(windowId);
}

export const openWindow = storeAction("createWindow");

export function switchToTab(tabId: string) {
  const tab = store().tabs[tabId];
  if (!tab) return;
  store().activate(tabId);
  if (tab.windowId !== focusedWindowOf(store())) focus(tab.windowId);
}

export async function closeTab(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  const w = tab && s.windows[tab.windowId];
  if (!tab || !w) return;
  const last = closesWindow(s, tabId) && !leavesEmptyWindow(s, tabId);
  if (last && s.settings.warnBeforeClosingLastTab && w.kind !== "private") {
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
      message: w.kind === "private" ? `Its ${tabs} close with it.` : `Its ${tabs} close with it. History › Recently Closed Groups brings it back.`,
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
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab) return;
  if (!isSiteMuted(s, tab)) return s.setMuted([tabId], !tab.muted);
  s.setSiteMuted(tabId, false);
  if (tab.muted) s.setMuted([tabId], false);
}

export const setSiteMuted = storeAction("setSiteMuted");

export function toggleSiteMute(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (tab) s.setSiteMuted(tabId, !isSiteMuted(s, tab));
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
      : `All data associated with this Profile will be removed. This action cannot be undone.${engineProfile(s, profileId) === "" ? await keptExtensionsNote() : ""}`,
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

type ProfileMove = { windowId: string; fromProfileId: string; title: (profileName: string) => string; confirmTitle: string };

async function profileMoveTarget(move: ProfileMove, target: string | null): Promise<string | null> {
  if (isIncognitoProfile(move.fromProfileId)) return null;
  const profileId = target ?? (await requestCreateProfile(move.windowId));
  if (!profileId || profileId === move.fromProfileId) return null;
  const shared = engineProfile(useBrowser.getState(), profileId) === engineProfile(useBrowser.getState(), move.fromProfileId);
  if (!store().settings.warnBeforeMovingTabsToProfile || shared) return profileId;
  const { confirmed, suppressed } = await confirm({
    title: move.title(store().profiles[profileId]?.name ?? "Profile"),
    message: "Moving tabs between profiles could result in some data being lost.",
    confirmTitle: move.confirmTitle,
    suppression: "Don't warn me again",
    windowId: move.windowId,
  });
  if (suppressed) store().updateSettings({ warnBeforeMovingTabsToProfile: false });
  return confirmed ? profileId : null;
}

export async function moveTabsToProfile(tabIds: string[], target: string | null) {
  const tabs = tabIds.map((id) => store().tabs[id]).filter((t) => !!t);
  const first = tabs[0];
  if (!first) return;
  const many = tabs.length > 1;
  const profileId = await profileMoveTarget(
    {
      windowId: first.windowId,
      fromProfileId: first.profileId,
      title: () => (many ? `Move ${tabs.length} Tabs to Profile?` : "Move Tab to Profile?"),
      confirmTitle: many ? "Move Tabs" : "Move Tab",
    },
    target,
  );
  if (!profileId) return;
  for (const tab of tabs) if (!isIncognitoProfile(tab.profileId)) store().moveTabToProfile(tab.id, profileId);
}

export const moveTabToProfile = (tabId: string, target: string | null) => moveTabsToProfile([tabId], target);

export async function moveGroupToProfile(groupId: string, target: string | null) {
  const g = store().groups[groupId];
  if (!g) return;
  const profileId = await profileMoveTarget({ windowId: g.windowId, fromProfileId: g.profileId, title: (name) => `Move Group to ${name}?`, confirmTitle: "Move Group" }, target);
  if (profileId) store().moveGroupToProfile(groupId, profileId);
}

export function moveGroupToWindow(groupId: string, target: string | null) {
  const windowId = store().moveGroupToWindow(groupId, target);
  if (windowId) focus(windowId);
}

export function moveTabToWindow(tabId: string, target: string | null) {
  const windowId = store().moveTabsToWindow([tabId], target);
  if (windowId) focus(windowId);
}

export function switchProfile(windowId: string, profileId: string, animated = false) {
  if (animated) pageToProfile(windowId, profileId);
  else store().switchProfile(windowId, profileId);
}

export function cycleProfile(windowId: string, delta: 1 | -1) {
  if (!cycleTarget(windowId, delta)) return;
  void stepPager(windowId, delta, true, store().profileOrder).then((ok) => ok || cycleFromStore(windowId, delta));
}

function cycleFromStore(windowId: string, delta: 1 | -1) {
  const target = cycleTarget(windowId, delta);
  if (target) switchProfile(windowId, target, true);
}

function cycleTarget(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.kind === "private" || s.profileOrder.length < 2) return null;
  const i = s.profileOrder.indexOf(w.profileId);
  return s.profileOrder[(i + delta + s.profileOrder.length) % s.profileOrder.length]!;
}

export function openUrls(urls: string[], windowId?: string | null) {
  let target = resolveWindowId(store(), windowId);
  for (const url of urls) {
    if (!target || store().windows[target]?.kind === "private") target = openWindow({ url });
    else store().newTab(target, { url });
  }
}

export async function openProfileMenu(windowId: string) {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.profileId;
  const items: ChoiceItem<{ open: "switch" | "window"; profileId: string }>[] = [
    ...s.profileOrder.flatMap((id) => {
      const profile = s.profiles[id]!;
      const swatch = profileAccentOf(profile);
      const shortcut = menuShortcut(`switchProfile:${id}`, s);
      const alternate = menuCommandAlternate(`switchProfile:${id}`, s);
      const switchItem = { value: { open: "switch" as const, profileId: id }, title: profile.name, checked: id === current, swatch, ...shortcut, modifiers: shortcut.modifiers ?? [] };
      if (!alternate) return [switchItem];
      return [switchItem, { value: { open: "window" as const, profileId: id }, title: `${profile.name} ↗`, alternate: true, swatch, ...alternate }];
    }),
    { separator: true },
    { id: "new", title: "New Profile", symbol: "plus" },
    { id: "edit", title: "Edit Profiles…", symbol: "pencil" },
  ];
  const choice = await chooseFromMenu(items);
  if (!choice) return;
  if (typeof choice !== "string") {
    if (choice.open === "switch") switchProfile(windowId, choice.profileId, true);
    else openWindow({ profileId: choice.profileId });
  } else if (choice === "new") {
    const id = await requestCreateProfile(windowId);
    if (id) switchProfile(windowId, id);
  } else if (choice === "edit") openSettings("profiles", current);
}
