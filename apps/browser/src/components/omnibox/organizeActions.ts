import type { CommandAction } from "@ardia/core";
import { prompt, showMenu, type MenuItem } from "@ardia/shell";
import { moveTabToProfile } from "../../lib/actions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTab, isIncognitoProfile, viewTabIds } from "../../store/model";
import { hiddenEmptyCard } from "../../store/newTabBar";
import { MAX_SPLIT_PANES, slotsOf, splitOf, type SplitSide } from "../../store/splits";
import type { SplitView, Tab } from "../../store/types";
import { openSplitPane } from "../layout/splitActions";
import { openSettings } from "../settings/windows";
import { tabTitle } from "../sidebar/actions";

type Context = { s: BrowserState; windowId: string; tab: Tab; split: SplitView | undefined };

type OrganizeDef = {
  id: string;
  title: string | ((c: Context) => string);
  icon: string;
  keywords: string[];
  shows(c: Context): boolean;
  run(c: Context): void | Promise<void>;
};

const store = () => useBrowser.getState();
const sideBySide = (split: SplitView | undefined) => split?.orientation === "horizontal";
const hasRoom = (split: SplitView | undefined) => !split || split.tabIds.length < MAX_SPLIT_PANES;
const stacked = ({ split, tab }: Context) => !!split && slotsOf(split).some((slot) => slot.length === 2 && slot.includes(tab.id));
const inProfiles = ({ s, windowId, tab }: Context) => !s.windows[windowId]?.incognito && !isIncognitoProfile(tab.profileId);

const newPane = ({ windowId, tab }: Context, side: SplitSide) => void openSplitPane(windowId, { anchorTabId: tab.id, side });

function splitCandidates({ s, windowId, tab, split }: Context): Tab[] {
  return viewTabIds(s, windowId)
    .map((id) => s.tabs[id]!)
    .filter((t) => t.id !== tab.id && !!t.url && !split?.tabIds.includes(t.id));
}

async function pickTabForSplit(c: Context) {
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

async function pickProfileForTab({ s, tab }: Context) {
  const items: MenuItem[] = [
    ...s.profileOrder.map((id) => ({ id, title: s.profiles[id]?.name ?? "", checked: id === tab.profileId, enabled: id !== tab.profileId })),
    { separator: true },
    { id: "new", title: "New Profile…" },
  ];
  const choice = await showMenu(items);
  if (choice) await moveTabToProfile(tab.id, choice);
}

async function renameProfile({ windowId }: Context) {
  const profileId = store().windows[windowId]?.profileId;
  const profile = profileId ? store().profiles[profileId] : undefined;
  if (!profileId || !profile) return;
  const name = await prompt({ title: "Rename Profile", value: profile.name, placeholder: "Profile name", confirmTitle: "Rename", windowId });
  if (name?.trim() && store().profiles[profileId]) store().updateProfile(profileId, { name: name.trim() });
}

const DEFS: OrganizeDef[] = [
  {
    id: "split:sideBySide",
    title: "Split View Side by Side",
    icon: "rectangle.split.2x1",
    keywords: ["split view", "side by side", "new split", "vertical split"],
    shows: (c) => !c.split,
    run: (c) => newPane(c, "right"),
  },
  {
    id: "split:stacked",
    title: "Split View Stacked",
    icon: "rectangle.split.1x2",
    keywords: ["split view", "stacked", "top and bottom", "horizontal split"],
    shows: (c) => !c.split,
    run: (c) => newPane(c, "bottom"),
  },
  {
    id: "split:withTab",
    title: ({ split }) => (split ? "Add Tab to Split View…" : "Split View with Tab…"),
    icon: "plus.rectangle.on.rectangle",
    keywords: ["split view", "add tab to split", "split with tab", "add pane"],
    shows: (c) => hasRoom(c.split) && splitCandidates(c).length > 0,
    run: pickTabForSplit,
  },
  {
    id: "split:add",
    title: ({ split }) => (sideBySide(split) ? "Add Vertical Split View" : "Add Horizontal Split View"),
    icon: "rectangle.split.3x1",
    keywords: ["split view", "add pane", "new pane"],
    shows: (c) => !!c.split && hasRoom(c.split),
    run: (c) => newPane(c, sideBySide(c.split) ? "right" : "bottom"),
  },
  {
    id: "split:cross",
    title: ({ split }) => (sideBySide(split) ? "Add Bottom Split" : "Add Right Split"),
    icon: "rectangle.bottomhalf.inset.filled",
    keywords: ["split view", "add pane", "stacked", "side by side"],
    shows: (c) => !!c.split && hasRoom(c.split) && !stacked(c),
    run: (c) => newPane(c, sideBySide(c.split) ? "bottom" : "right"),
  },
  {
    id: "split:flip",
    title: "Flip Split View",
    icon: "arrow.left.arrow.right",
    keywords: ["split view", "swap panes"],
    shows: (c) => !!c.split,
    run: ({ split }) => (split ? store().flipSplit(split.id) : undefined),
  },
  {
    id: "split:convert",
    title: ({ split }) => (sideBySide(split) ? "Convert to Vertical Split View" : "Convert to Horizontal Split View"),
    icon: "rectangle.split.1x2",
    keywords: ["split view", "rotate split", "stacked", "side by side"],
    shows: (c) => !!c.split,
    run: ({ split }) => (split ? store().toggleSplitOrientation(split.id) : undefined),
  },
  {
    id: "split:remove",
    title: "Remove from Split View",
    icon: "rectangle.portrait.and.arrow.right",
    keywords: ["split view", "remove pane", "unsplit tab"],
    shows: (c) => !!c.split,
    run: ({ tab }) => store().removeTabFromSplit(tab.id),
  },
  {
    id: "split:exit",
    title: "Exit Split View",
    icon: "rectangle.split.3x1",
    keywords: ["split view", "separate all tabs", "unsplit", "close split view", "end split"],
    shows: (c) => !!c.split,
    run: ({ split }) => (split ? store().separateSplit(split.id) : undefined),
  },
  {
    id: "profile:moveTab",
    title: "Move Tab to Profile…",
    icon: "person.crop.circle",
    keywords: ["move tab", "move to profile", "move to space", "send tab to profile"],
    shows: inProfiles,
    run: pickProfileForTab,
  },
  {
    id: "profile:rename",
    title: "Rename Profile…",
    icon: "pencil",
    keywords: ["rename profile", "rename space", "profile name"],
    shows: inProfiles,
    run: renameProfile,
  },
  {
    id: "profile:edit",
    title: "Edit Profiles…",
    icon: "person.2",
    keywords: ["manage profiles", "reorder profiles", "delete profile", "spaces", "profile settings"],
    shows: inProfiles,
    run: ({ s, windowId }) => openSettings("profiles", s.windows[windowId]?.profileId),
  },
];

const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

function contextFor(s: BrowserState, windowId: string): Context | null {
  const w = s.windows[windowId];
  const tab = activeTab(s, windowId);
  if (!w || w.kind === "small" || !tab || hiddenEmptyCard(s, tab)) return null;
  return { s, windowId, tab, split: splitOf(s, tab.id) };
}

export function organizeActions(s: BrowserState, windowId: string): CommandAction[] {
  const c = contextFor(s, windowId);
  if (!c) return [];
  const out: CommandAction[] = DEFS.filter((d) => d.shows(c)).map((d) => ({
    id: d.id,
    title: typeof d.title === "string" ? d.title : d.title(c),
    icon: d.icon,
    keywords: d.keywords,
  }));
  if (inProfiles(c)) {
    for (const id of s.profileOrder) {
      if (id === c.tab.profileId) continue;
      const name = s.profiles[id]?.name ?? "";
      out.push({ id: `moveTabToProfile:${id}`, title: `Move Tab to ${name}`, icon: "arrow.right.circle", keywords: [name, "move tab", "move to profile", "move to space"] });
    }
    out.push({ id: "moveTabToProfile:new", title: "Move Tab to New Profile", icon: "person.crop.circle.badge.plus", keywords: ["move tab", "new profile", "new space"] });
  }
  return out;
}

export function runOrganizeAction(id: string, windowId: string): boolean {
  const def = BY_ID.get(id);
  if (!def) return false;
  const c = contextFor(store(), windowId);
  if (c && def.shows(c)) void def.run(c);
  return true;
}
