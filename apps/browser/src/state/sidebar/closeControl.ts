import { closeGroup } from "../browser/actions";
import { shortcutHint, withShortcut } from "../commands/commandShortcuts";
import { useBrowser, type BrowserState } from "../browser/store";
import { useBrowserWhile } from "../tabs/tabWatch";
import { rootOf } from "../groups/groups";
import { closeIntent, closeKind, openPages } from "../tabs/tabs";
import { middleClickTab } from "./clearTabs";

export type CloseControl = { icon: "xmark" | "minus"; tooltip: string };

const REMOVE_PIN: CloseControl = { icon: "xmark", tooltip: "Remove Pinned Tab" };
const CLOSE_GROUP: CloseControl = { icon: "xmark", tooltip: "Close Group" };
const UNLOAD_GROUP: CloseControl = { icon: "minus", tooltip: "Unload Tabs" };

const CLOSE_KEY_CONTROLS = { close: { icon: "xmark", title: "Close Tab" }, unload: { icon: "minus", title: "Unload Tab" } } as const;
const keyedControls = new Map<string, CloseControl>();

function closeKeyControl({ icon, title }: { icon: CloseControl["icon"]; title: string }, s: BrowserState): CloseControl {
  const tooltip = withShortcut(title, shortcutHint("closeTab", s));
  let control = keyedControls.get(tooltip);
  if (!control) keyedControls.set(tooltip, (control = { icon, tooltip }));
  return control;
}

export function tabCloseControl(s: BrowserState, tabId: string): CloseControl {
  const kind = closeKind(s, tabId);
  return kind === "removePin" ? REMOVE_PIN : closeKeyControl(CLOSE_KEY_CONTROLS[kind], s);
}

export const useTabCloseControl = (tabId: string) => useBrowser((s) => tabCloseControl(s, tabId));

export const useTabCloseControlWhile = (tabId: string, live: boolean) => useBrowserWhile(live, (s) => (live ? tabCloseControl(s, tabId) : null));

const openMembers = (s: BrowserState, groupId: string) => (s.groups[groupId]?.tabIds ?? []).flatMap((id) => openPages(s, id));

export function groupCloseControl(s: BrowserState, groupId: string): CloseControl | null {
  if (!s.groups[groupId]) return null;
  if (!rootOf(s.groups, groupId)?.pinned) return CLOSE_GROUP;
  return openMembers(s, groupId).length ? UNLOAD_GROUP : null;
}

export const useGroupCloseControl = (groupId: string) => useBrowser((s) => groupCloseControl(s, groupId));

export const useGroupCloseControlWhile = (groupId: string, live: boolean) => useBrowserWhile(live, (s) => (live ? groupCloseControl(s, groupId) : null));

export function pressGroupClose(groupId: string) {
  const s = useBrowser.getState();
  const control = groupCloseControl(s, groupId);
  if (control === UNLOAD_GROUP) s.closeTabs(openMembers(s, groupId));
  else if (control === CLOSE_GROUP) void closeGroup(groupId);
}

export function pressTabClose(tabId: string) {
  const s = useBrowser.getState();
  const intent = closeIntent(s, tabId);
  if (intent.kind === "unload") s.closeTabs(intent.ids);
  else middleClickTab(tabId);
}
