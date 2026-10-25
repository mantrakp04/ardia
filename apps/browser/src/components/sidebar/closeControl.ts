import { closeGroup } from "../../lib/actions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { rootOf } from "../../store/groups";
import { inPinnedContainer } from "../../store/model";
import { isClosedPin } from "../../store/organize";
import { holderOf } from "../../store/pinShare";
import { middleClickTab } from "./menus";

export type CloseControl = { icon: "xmark" | "minus"; tooltip: string };

const CLOSE_TAB: CloseControl = { icon: "xmark", tooltip: "Close Tab (⌘W)" };
const UNLOAD_TAB: CloseControl = { icon: "minus", tooltip: "Unload Tab (⌘W)" };
const REMOVE_PIN: CloseControl = { icon: "xmark", tooltip: "Remove Pinned Tab" };
const CLOSE_GROUP: CloseControl = { icon: "xmark", tooltip: "Close Group" };
const UNLOAD_GROUP: CloseControl = { icon: "minus", tooltip: "Unload Tabs" };

export function tabCloseControl(s: BrowserState, tabId: string): CloseControl {
  if (!inPinnedContainer(s, tabId)) return CLOSE_TAB;
  return isClosedPin(s, tabId) ? REMOVE_PIN : UNLOAD_TAB;
}

export const useTabCloseControl = (tabId: string) => useBrowser((s) => tabCloseControl(s, tabId));

function openPages(s: BrowserState, tabId: string): string[] {
  const t = s.tabs[tabId];
  if (!t) return [];
  if (t.navigation || t.adoptId || t.pageIn) return [tabId];
  const holder = holderOf(s, tabId);
  return holder ? [tabId, holder.id] : [];
}

const openMembers = (s: BrowserState, groupId: string) => (s.groups[groupId]?.tabIds ?? []).flatMap((id) => openPages(s, id));

export function groupCloseControl(s: BrowserState, groupId: string): CloseControl | null {
  if (!s.groups[groupId]) return null;
  if (!rootOf(s.groups, groupId)?.pinned) return CLOSE_GROUP;
  return openMembers(s, groupId).length ? UNLOAD_GROUP : null;
}

export const useGroupCloseControl = (groupId: string) => useBrowser((s) => groupCloseControl(s, groupId));

export function pressGroupClose(groupId: string) {
  const s = useBrowser.getState();
  const control = groupCloseControl(s, groupId);
  if (control === UNLOAD_GROUP) s.closeTabs(openMembers(s, groupId));
  else if (control === CLOSE_GROUP) void closeGroup(groupId);
}

export function pressTabClose(tabId: string) {
  const s = useBrowser.getState();
  const pages = tabCloseControl(s, tabId) === UNLOAD_TAB ? openPages(s, tabId) : [];
  if (pages.length > 1) s.closeTabs(pages);
  else middleClickTab(tabId);
}
