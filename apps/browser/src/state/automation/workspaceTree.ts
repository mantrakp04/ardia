import type { BrowserState } from "../browser/store";
import type { GroupColor, Tab, TabGroup } from "../browser/types";
import { activeTabId, inPinnedContainer, isIncognitoProfile, pinSection } from "../browser/model";
import { groupPath, innermostGroupOf, rootOf } from "../groups/groups";
import { NO_GROUP_ICON } from "../groups/groupIcons";
import { groupLabel } from "../pins/tabGrouping";
import { tileFolderOf } from "../pins/tileFolders";
import { splitOf } from "../splits/splits";
import { isAsleep, isLazy } from "../tabs/pageSession";
import { isSleeping } from "../tabs/sleepingTabs";
import { focusedWindowOf } from "../windows/ui";
import { eligibleKind, isEligibleTab, ownEntry, shownPage, type AutomationWindowKind } from "./automationWindows";

export type TabNode = {
  type: "tab";
  id: string;
  url: string;
  title: string;
  customTitle: string | null;
  icon: string | null;
  pin: "tile" | "row" | null;
  pinned: boolean;
  folder: { id: string; name: string } | null;
  group: string | null;
  split: string | null;
  active: boolean;
  muted: boolean;
  asleep: boolean;
  index: number;
};

export type GroupNode = {
  type: "group";
  id: string;
  name: string;
  label: string;
  icon: string | null;
  color: string;
  collapsed: boolean;
  pinned: boolean;
  parent: string | null;
  items: (TabNode | GroupNode)[];
};

export type FolderNode = { type: "folder"; id: string; name: string; items: TabNode[] };

export type Space = {
  profile: string;
  profileName: string;
  shown: boolean;
  activeTab: string | null;
  topApps: (TabNode | FolderNode)[];
  pinned: (TabNode | GroupNode)[];
  tabs: (TabNode | GroupNode)[];
};

export type WorkspaceWindow = { id: string; kind: AutomationWindowKind; focused: boolean; profile: string; profileName: string; activeTab: string | null; spaces: Space[] };

export type Workspace = { profiles: { id: string; name: string }[]; windows: WorkspaceWindow[] };

type Snapshot = Pick<BrowserState, "windows" | "windowOrder" | "tabs" | "peeks" | "groups" | "profiles" | "profileOrder" | "splits" | "ui">;

export const colorName = (color: GroupColor | null): string => color ?? "neutral";

export const iconName = (icon: string | null): string | null => (icon === NO_GROUP_ICON ? "none" : icon);

export function tabNode(s: Snapshot, id: string, index = -1): TabNode {
  const t = s.tabs[id] as Tab;
  const folder = tileFolderOf(t);
  const section = pinSection(t);
  return {
    type: "tab",
    id,
    ...shownPage(t),
    customTitle: t.customTitle,
    icon: t.customIcon,
    pin: section === "none" ? null : section,
    pinned: inPinnedContainer(s, id),
    folder: folder ? { id: folder.id, name: folder.name } : null,
    group: innermostGroupOf(s.groups, id)?.id ?? null,
    split: splitOf(s, id)?.id ?? null,
    active: activeTabId(s as BrowserState, t.windowId, t.profileId) === id,
    muted: t.muted,
    asleep: isAsleep(t) || isLazy(t) || isSleeping(id),
    index,
  };
}

export function groupFields(s: Snapshot, g: TabGroup): Omit<GroupNode, "items"> {
  return {
    type: "group",
    id: g.id,
    name: g.name,
    label: groupLabel(s, g),
    icon: iconName(g.icon),
    color: colorName(g.color),
    collapsed: g.collapsed,
    pinned: g.pinned,
    parent: g.parentId ?? null,
  };
}

export const isEligibleGroup = (s: Pick<BrowserState, "windows" | "groups">, id: string): boolean => {
  const g = ownEntry(s.groups, id);
  return !!g && eligibleKind(s, g.windowId) === "normal" && !isIncognitoProfile(g.profileId);
};

function spaceTabIds(s: Snapshot, windowId: string, profileId: string): string[] {
  return (s.windows[windowId]?.tabIds ?? []).filter((id) => s.tabs[id]?.windowId === windowId && s.tabs[id]?.profileId === profileId && isEligibleTab(s, id));
}

function buildSpace(s: Snapshot, windowId: string, profileId: string, shown: boolean): Space {
  const ids = spaceTabIds(s, windowId, profileId);
  const index = new Map(ids.map((id, i) => [id, i]));
  const node = (id: string) => tabNode(s, id, index.get(id) ?? -1);
  const built = new Map<string, GroupNode>();
  const groupNode = (g: TabGroup): GroupNode => {
    const out: GroupNode = { ...groupFields(s, g), items: [] };
    built.set(g.id, out);
    for (const id of g.tabIds) {
      if (!index.has(id)) continue;
      const path = groupPath(s.groups, innermostGroupOf(s.groups, id)?.id ?? g.id);
      const child = path[path.indexOf(g.id) + 1];
      if (!child) out.items.push(node(id));
      else if (!built.has(child) && s.groups[child]) out.items.push(groupNode(s.groups[child]!));
    }
    return out;
  };
  const space: Space = {
    profile: profileId,
    profileName: s.profiles[profileId]?.name ?? "",
    shown,
    activeTab: activeTabId(s as BrowserState, windowId, profileId) ?? null,
    topApps: [],
    pinned: [],
    tabs: [],
  };
  for (const id of ids) {
    const t = s.tabs[id]!;
    if (pinSection(t) === "tile") {
      const folder = tileFolderOf(t);
      const last = space.topApps.at(-1);
      if (!folder) space.topApps.push(node(id));
      else if (last?.type === "folder" && last.id === folder.id) last.items.push(node(id));
      else space.topApps.push({ type: "folder", id: folder.id, name: folder.name, items: [node(id)] });
      continue;
    }
    const inner = innermostGroupOf(s.groups, id);
    const root = inner ? rootOf(s.groups, inner.id) : undefined;
    if (root && built.has(root.id)) continue;
    const list = (root ? root.pinned : t.pin) ? space.pinned : space.tabs;
    list.push(root ? groupNode(root) : node(id));
  }
  return space;
}

export function workspace(s: Snapshot, filter: { window?: string | null; profile?: string | null } = {}): Workspace {
  const focused = focusedWindowOf(s);
  const profiles = s.profileOrder.filter((id) => s.profiles[id] && !isIncognitoProfile(id)).map((id) => ({ id, name: s.profiles[id]!.name }));
  const windows = s.windowOrder.flatMap((id): WorkspaceWindow[] => {
    const kind = eligibleKind(s, id);
    const w = s.windows[id];
    if (!kind || !w || (filter.window && filter.window !== id)) return [];
    const present = new Set([w.profileId, ...w.tabIds.map((t) => s.tabs[t]?.profileId).filter((p): p is string => !!p)]);
    const order = [...s.profileOrder.filter((p) => present.has(p)), ...[...present].filter((p) => !s.profileOrder.includes(p))];
    const spaces = order
      .filter((p) => !isIncognitoProfile(p) && (!filter.profile || filter.profile === p))
      .map((p) => buildSpace(s, id, p, p === w.profileId));
    if (filter.profile && !spaces.length) return [];
    return [{ id, kind, focused: id === focused, profile: w.profileId, profileName: s.profiles[w.profileId]?.name ?? "", activeTab: activeTabId(s as BrowserState, id) ?? null, spaces }];
  });
  return { profiles, windows };
}
