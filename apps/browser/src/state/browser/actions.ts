import { stepPager } from "../../platform/pager";
import { confirm } from "../../platform/dialogs";
import { focusWindow } from "../../platform/windows";
import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { pageToSpace } from "../windows/spacePager";
import { spaceNames, requestCreateSpace } from "../spaces/createSpaceRequest";
import { storeAction, useBrowser } from "./store";
import { rootOf } from "../groups/groups";
import { engineProfile, closesWindow, engineProfileForSpace, isIncognitoSpace, plural, resolveWindowId } from "./model";
import { leavesEmptyWindow } from "../omnibox/newTabBarPolicy";
import { groupLabel } from "../pins/tabGrouping";
import { sharingSpaces } from "../spaces/spaces";
import { closeWindowAnimated } from "../windows/closeAnimated";
import { applyHeldReports } from "../../platform/nativeEvents";
import { closeWindowDialog } from "../windows/windowClose";
import { menuCommandAlternate, menuShortcut } from "../commands/commandShortcuts";
import { openSettings } from "../settings/settingsWindows";
import { profileAccentOf } from "../spaces/looks";
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

export async function deleteSpace(spaceId: string, windowId?: string) {
  const s = store();
  const space = s.spaces[spaceId];
  if (!space) return false;
  if (s.spaceOrder.length <= 1 || s.settings.defaultSpaceId === spaceId) {
    await confirm({ title: "Cannot Delete Space", message: s.spaceOrder.length <= 1 ? "Keep at least one space. Create another space before deleting this one." : "This is your default space. Choose another default space in Settings before deleting it.", confirmTitle: "OK", windowId });
    return false;
  }
  const { confirmed } = await confirm({
    title: `Delete “${space.name}”?`,
    message: "Its tabs, saved rows and folders will be removed. Browsing data and shared Top Apps stay with its profile.",
    confirmTitle: "Delete Space",
    destructive: true,
    windowId,
  });
  if (!confirmed) return false;
  store().deleteSpace(spaceId);
  return !store().spaces[spaceId];
}

type SpaceMove = { windowId: string; fromSpaceId: string; title: (spaceName: string) => string; confirmTitle: string };

async function spaceMoveTarget(move: SpaceMove, target: string | null): Promise<string | null> {
  if (isIncognitoSpace(move.fromSpaceId)) return null;
  const spaceId = target ?? (await requestCreateSpace(move.windowId));
  if (!spaceId || spaceId === move.fromSpaceId) return null;
  const shared = engineProfile(useBrowser.getState(), spaceId) === engineProfile(useBrowser.getState(), move.fromSpaceId);
  if (!store().settings.warnBeforeMovingTabsToSpace || shared) return spaceId;
  const { confirmed, suppressed } = await confirm({
    title: move.title(store().spaces[spaceId]?.name ?? "Space"),
    message: "Moving tabs between spaces could result in some data being lost.",
    confirmTitle: move.confirmTitle,
    suppression: "Don't warn me again",
    windowId: move.windowId,
  });
  if (suppressed) store().updateSettings({ warnBeforeMovingTabsToSpace: false });
  return confirmed ? spaceId : null;
}

export async function moveTabsToSpace(tabIds: string[], target: string | null) {
  const tabs = tabIds.map((id) => store().tabs[id]).filter((t) => !!t);
  const first = tabs[0];
  if (!first) return;
  const many = tabs.length > 1;
  const spaceId = await spaceMoveTarget(
    {
      windowId: first.windowId,
      fromSpaceId: first.spaceId,
      title: () => (many ? `Move ${tabs.length} Tabs to Space?` : "Move Tab to Space?"),
      confirmTitle: many ? "Move Tabs" : "Move Tab",
    },
    target,
  );
  if (!spaceId) return;
  for (const tab of tabs) if (!isIncognitoSpace(tab.spaceId)) store().moveTabToSpace(tab.id, spaceId);
}

export const moveTabToSpace = (tabId: string, target: string | null) => moveTabsToSpace([tabId], target);

export async function moveGroupToSpace(groupId: string, target: string | null) {
  const g = store().groups[groupId];
  if (!g) return;
  const spaceId = await spaceMoveTarget({ windowId: g.windowId, fromSpaceId: g.spaceId, title: (name) => `Move Group to ${name}?`, confirmTitle: "Move Group" }, target);
  if (spaceId) store().moveGroupToSpace(groupId, spaceId);
}

export function moveGroupToWindow(groupId: string, target: string | null) {
  const windowId = store().moveGroupToWindow(groupId, target);
  if (windowId) focus(windowId);
}

export function moveTabToWindow(tabId: string, target: string | null) {
  const windowId = store().moveTabsToWindow([tabId], target);
  if (windowId) focus(windowId);
}

export function switchSpace(windowId: string, spaceId: string, animated = false) {
  if (animated) pageToSpace(windowId, spaceId);
  else store().switchSpace(windowId, spaceId);
}

export function cycleSpace(windowId: string, delta: 1 | -1) {
  if (!cycleTarget(windowId, delta)) return;
  void stepPager(windowId, delta, true, store().spaceOrder).then((ok) => ok || cycleFromStore(windowId, delta));
}

function cycleFromStore(windowId: string, delta: 1 | -1) {
  const target = cycleTarget(windowId, delta);
  if (target) switchSpace(windowId, target, true);
}

function cycleTarget(windowId: string, delta: 1 | -1) {
  const s = store();
  const w = s.windows[windowId];
  if (!w || w.kind === "private" || s.spaceOrder.length < 2) return null;
  const i = s.spaceOrder.indexOf(w.spaceId);
  return s.spaceOrder[(i + delta + s.spaceOrder.length) % s.spaceOrder.length]!;
}

export function openUrls(urls: string[], windowId?: string | null) {
  let target = resolveWindowId(store(), windowId);
  for (const url of urls) {
    if (!target || store().windows[target]?.kind === "private") target = openWindow({ url });
    else store().newTab(target, { url });
  }
}

export async function openSpaceMenu(windowId: string) {
  const s = useBrowser.getState();
  const current = s.windows[windowId]?.spaceId;
  const items: ChoiceItem<{ open: "switch" | "window"; spaceId: string }>[] = [
    ...s.spaceOrder.flatMap((id) => {
      const profile = s.spaces[id]!;
      const swatch = profileAccentOf(profile);
      const shortcut = menuShortcut(`switchSpace:${id}`, s);
      const alternate = menuCommandAlternate(`switchSpace:${id}`, s);
      const switchItem = { value: { open: "switch" as const, spaceId: id }, title: profile.name, checked: id === current, swatch, ...shortcut, modifiers: shortcut.modifiers ?? [] };
      if (!alternate) return [switchItem];
      return [switchItem, { value: { open: "window" as const, spaceId: id }, title: `${profile.name} ↗`, alternate: true, swatch, ...alternate }];
    }),
    { separator: true },
    { id: "new", title: "New Space", symbol: "plus" },
    { id: "edit", title: "Edit Spaces…", symbol: "pencil" },
  ];
  const choice = await chooseFromMenu(items);
  if (!choice) return;
  if (typeof choice !== "string") {
    if (choice.open === "switch") switchSpace(windowId, choice.spaceId, true);
    else openWindow({ spaceId: choice.spaceId });
  } else if (choice === "new") {
    const id = await requestCreateSpace(windowId);
    if (id) switchSpace(windowId, id);
  } else if (choice === "edit") openSettings("spaces", current);
}
