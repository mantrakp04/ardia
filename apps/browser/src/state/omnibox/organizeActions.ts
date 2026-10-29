import type { CommandAction } from "@ardia/core";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTab, isIncognitoProfile, viewTabIds } from "../browser/model";
import { hiddenEmptyCard } from "../omnibox/newTabBarPolicy";
import { isStacked, MAX_SPLIT_PANES, splitOf, splitTabIds, splitTabIdsOf } from "../splits/splits";
import type { SplitView, Tab } from "../browser/types";

export type OrganizeContext = { s: BrowserState; windowId: string; tab: Tab; split: SplitView | undefined };

type OrganizeDef<Id extends string = string> = {
  id: Id;
  title: string | ((c: OrganizeContext) => string);
  icon: string;
  keywords: string[];
  shows(c: OrganizeContext): boolean;
};

export const sideBySide = (split: SplitView | undefined) => split?.orientation === "horizontal";
const hasRoom = (split: SplitView | undefined) => !split || splitTabIds(split).length < MAX_SPLIT_PANES;
const stacked = ({ split, tab }: OrganizeContext) => !!split && isStacked(split, tab.id);
const inProfiles = ({ s, windowId, tab }: OrganizeContext) => s.windows[windowId]?.kind !== "private" && !isIncognitoProfile(tab.profileId);

export function splitCandidates({ s, windowId, tab, split }: OrganizeContext): Tab[] {
  return viewTabIds(s, windowId)
    .map((id) => s.tabs[id]!)
    .filter((t) => t.id !== tab.id && !!t.url && !splitTabIdsOf(split)?.includes(t.id));
}

const organizeDefs = <const Id extends string>(defs: OrganizeDef<Id>[]) => defs;

const DEFS = organizeDefs([
  {
    id: "split:sideBySide",
    title: "Split View Side by Side",
    icon: "rectangle.split.2x1",
    keywords: ["split view", "side by side", "new split", "vertical split"],
    shows: (c) => !c.split,
  },
  {
    id: "split:stacked",
    title: "Split View Stacked",
    icon: "rectangle.split.1x2",
    keywords: ["split view", "stacked", "top and bottom", "horizontal split"],
    shows: (c) => !c.split,
  },
  {
    id: "split:withTab",
    title: ({ split }) => (split ? "Add Tab to Split View…" : "Split View with Tab…"),
    icon: "plus.rectangle.on.rectangle",
    keywords: ["split view", "add tab to split", "split with tab", "add pane"],
    shows: (c) => hasRoom(c.split) && splitCandidates(c).length > 0,
  },
  {
    id: "split:add",
    title: ({ split }) => (sideBySide(split) ? "Add Vertical Split View" : "Add Horizontal Split View"),
    icon: "rectangle.split.3x1",
    keywords: ["split view", "add pane", "new pane"],
    shows: (c) => !!c.split && hasRoom(c.split),
  },
  {
    id: "split:cross",
    title: ({ split }) => (sideBySide(split) ? "Add Bottom Split" : "Add Right Split"),
    icon: "rectangle.bottomhalf.inset.filled",
    keywords: ["split view", "add pane", "stacked", "side by side"],
    shows: (c) => !!c.split && hasRoom(c.split) && !stacked(c),
  },
  {
    id: "split:flip",
    title: "Flip Split View",
    icon: "arrow.left.arrow.right",
    keywords: ["split view", "swap panes"],
    shows: (c) => !!c.split,
  },
  {
    id: "split:convert",
    title: ({ split }) => (sideBySide(split) ? "Convert to Vertical Split View" : "Convert to Horizontal Split View"),
    icon: "rectangle.split.1x2",
    keywords: ["split view", "rotate split", "stacked", "side by side"],
    shows: (c) => !!c.split,
  },
  {
    id: "split:remove",
    title: "Remove from Split View",
    icon: "rectangle.portrait.and.arrow.right",
    keywords: ["split view", "remove pane", "unsplit tab"],
    shows: (c) => !!c.split,
  },
  {
    id: "split:exit",
    title: "Exit Split View",
    icon: "rectangle.split.3x1",
    keywords: ["split view", "separate all tabs", "unsplit", "close split view", "end split"],
    shows: (c) => !!c.split,
  },
  {
    id: "profile:moveTab",
    title: "Move Tab to Profile…",
    icon: "person.crop.circle",
    keywords: ["move tab", "move to profile", "move to space", "send tab to profile"],
    shows: inProfiles,
  },
  {
    id: "profile:rename",
    title: "Rename Profile…",
    icon: "pencil",
    keywords: ["rename profile", "rename space", "profile name"],
    shows: inProfiles,
  },
  {
    id: "profile:edit",
    title: "Edit Profiles…",
    icon: "person.2",
    keywords: ["manage profiles", "reorder profiles", "delete profile", "spaces", "profile settings"],
    shows: inProfiles,
  },
]);

export type OrganizeId = (typeof DEFS)[number]["id"];

const BY_ID = new Map<string, OrganizeDef>(DEFS.map((d) => [d.id, d]));

export const isOrganizeId = (id: string): id is OrganizeId => BY_ID.has(id);

function contextFor(s: BrowserState, windowId: string): OrganizeContext | null {
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

export function shownOrganizeContext(id: OrganizeId, windowId: string): OrganizeContext | null {
  const c = contextFor(useBrowser.getState(), windowId);
  return c && BY_ID.get(id)?.shows(c) ? c : null;
}
