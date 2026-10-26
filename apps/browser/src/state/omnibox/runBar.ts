import type { Suggestion } from "@ardia/core";
import { prompt } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import type { BrowserCommand } from "../../platform/commands";
import { moveTabToProfile } from "../browser/actions";
import { runCommand } from "../commands/commands";
import { useBrowser } from "../browser/store";
import { splitOf, type SplitSide } from "../splits/splits";
import { openExtensionFromMenu } from "../extensions/bridge";
import { openOptions, shownIn } from "../extensions/actions";
import { openSplitPane } from "../splits/actions";
import { openSettings } from "../settings/settingsWindows";
import { tabTitle } from "../sidebar/actions";
import { isOrganizeId, shownOrganizeContext, sideBySide, splitCandidates, type OrganizeContext, type OrganizeId } from "./organizeActions";

const store = () => useBrowser.getState();

const newPane = ({ windowId, tab }: OrganizeContext, side: SplitSide) => void openSplitPane(windowId, { anchorTabId: tab.id, side });

async function pickTabForSplit(c: OrganizeContext) {
  const tabs = splitCandidates(c);
  if (!tabs.length) return;
  const choice = await showMenu(tabs.map((t) => ({ id: t.id, title: tabTitle(t) })));
  if (!choice) return;
  const now = store();
  const tab = now.tabs[c.tab.id];
  if (!tab || !now.tabs[choice]) return;
  const split = splitOf(now, tab.id);
  openSplitPane(c.windowId, { tabId: choice, anchorTabId: tab.id, side: split && !sideBySide(split) ? "bottom" : "right" });
}

async function pickProfileForTab({ s, tab }: OrganizeContext) {
  const items: MenuItem[] = [
    ...s.profileOrder.map((id) => ({ id, title: s.profiles[id]?.name ?? "", checked: id === tab.profileId, enabled: id !== tab.profileId })),
    { separator: true },
    { id: "new", title: "New Profile…" },
  ];
  const choice = await showMenu(items);
  if (choice) await moveTabToProfile(tab.id, choice);
}

async function renameProfile({ windowId }: OrganizeContext) {
  const profileId = store().windows[windowId]?.profileId;
  const profile = profileId ? store().profiles[profileId] : undefined;
  if (!profileId || !profile) return;
  const name = await prompt({ title: "Rename Profile", value: profile.name, placeholder: "Profile name", confirmTitle: "Rename", windowId });
  if (name?.trim() && store().profiles[profileId]) store().updateProfile(profileId, { name: name.trim() });
}

const RUN_ORGANIZE: Record<OrganizeId, (c: OrganizeContext) => void | Promise<void>> = {
  "split:sideBySide": (c) => newPane(c, "right"),
  "split:stacked": (c) => newPane(c, "bottom"),
  "split:withTab": pickTabForSplit,
  "split:add": (c) => newPane(c, sideBySide(c.split) ? "right" : "bottom"),
  "split:cross": (c) => newPane(c, sideBySide(c.split) ? "bottom" : "right"),
  "split:flip": ({ split }) => (split ? store().flipSplit(split.id) : undefined),
  "split:convert": ({ split }) => (split ? store().toggleSplitOrientation(split.id) : undefined),
  "split:remove": ({ tab }) => store().removeTabFromSplit(tab.id),
  "split:exit": ({ split }) => (split ? store().separateSplit(split.id) : undefined),
  "profile:moveTab": pickProfileForTab,
  "profile:rename": renameProfile,
  "profile:edit": ({ s, windowId }) => openSettings("profiles", s.windows[windowId]?.profileId),
};

export function runBarAction(id: string, windowId: string) {
  if (isOrganizeId(id)) {
    const c = shownOrganizeContext(id, windowId);
    if (c) void RUN_ORGANIZE[id](c);
    return;
  }
  const i = id.indexOf(":");
  const command = (i < 0 ? id : id.slice(0, i)) as BrowserCommand;
  const arg = i < 0 ? null : id.slice(i + 1);
  runCommand({ command, arg, windowId });
}

export function runBarExtension(s: Extract<Suggestion, { kind: "extension" }>, windowId: string) {
  if (s.open === "action") return openExtensionFromMenu(windowId, s.id);
  const ext = shownIn(windowId, s.id);
  if (ext) openOptions(windowId, ext);
}
