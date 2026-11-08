import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { activeTabId, inPinnedContainer, pinSection } from "../browser/model";
import { canNest, innermostGroupOf, rootOf } from "../groups/groups";
import { groupKeptOpen } from "../groups/closeGuard";
import { NO_GROUP_ICON } from "../groups/groupIcons";
import type { TabPlacement } from "../pins/placing";
import { isSiteMuted } from "../tabs/mute";
import { needsPage, wokenPage } from "../tabs/pageSession";
import { isSleeping } from "../tabs/sleepingTabs";
import { webviews } from "../../platform/webviews";
import { eligibleKind } from "./automationWindows";
import { groupColor, type IconValue, type Op } from "./workspaceOps";
import {
  anchorRef,
  besideAnchor,
  blockEnd,
  defaultWindow,
  groupRef,
  nextOutside,
  normalWindow,
  OpError,
  profileOf,
  store,
  tabRef,
  tabRefs,
  type Destination,
  type OpResult,
} from "./workspaceTargets";

const str = (v: unknown) => v as string;
const opt = (v: unknown) => v as string | undefined;

function organizable(ids: string[]) {
  const s = store();
  for (const id of ids) if (eligibleKind(s, s.tabs[id]!.windowId) !== "normal") throw new OpError("bad_request", `Tab ${id} is in Little Ardia, which holds one tab.`);
}

function intoSpace(ids: string[], windowId: string, profileId: string) {
  for (const id of ids) {
    const t = store().tabs[id]!;
    if (t.profileId !== profileId) {
      if (pinSection(t) === "tile") throw new OpError("bad_request", `Tab ${id} is a Top Apps tile, which stays with its profile.`);
      store().moveTabToProfile(id, profileId, { background: true });
    }
  }
  const away = ids.filter((id) => store().tabs[id]!.windowId !== windowId);
  if (away.length) store().moveTabsToWindow(away, windowId, { background: true });
  for (const id of ids) {
    const t = store().tabs[id];
    if (t?.windowId !== windowId || t.profileId !== profileId) throw new OpError("failed", `Tab ${id} couldn't move there.`);
  }
}

function placeEach(ids: string[], placement: TabPlacement) {
  for (const id of ids) store().placeTabs([id], placement);
}

function defaultBefore(s: BrowserState, ids: string[], windowId: string, profileId: string): string | null {
  const first = s.tabs[ids[0]!]!;
  if (first.windowId !== windowId) return null;
  return nextOutside(s, windowId, profileId, blockEnd(s, ids[0]!), new Set(ids));
}

function destination(results: OpResult[], op: Op, moving: ReadonlySet<string>, group: TabGroup | null | undefined): Destination | null {
  const ref = opt(op.before) ?? opt(op.after);
  if (ref) {
    const anchor = anchorRef(results, ref);
    if (group && anchor.windowId !== group.windowId) throw new OpError("bad_request", `${ref} isn't in group ${group.id}'s window.`);
    return besideAnchor(anchor, op.after !== undefined, moving, group);
  }
  if (group) return { placement: { pinned: false, groupId: group.id, beforeId: null }, windowId: group.windowId, profileId: group.profileId };
  return null;
}

function space(op: Op, fallback?: { windowId: string; profileId: string }): { windowId: string; profileId: string } {
  const profileId = op.profile !== undefined ? profileOf(str(op.profile)) : undefined;
  if (op.window !== undefined) {
    const windowId = normalWindow(str(op.window));
    return { windowId, profileId: profileId ?? store().windows[windowId]!.profileId };
  }
  if (fallback && (!profileId || profileId === fallback.profileId)) return fallback;
  const windowId = defaultWindow(profileId);
  return { windowId, profileId: profileId ?? store().windows[windowId]!.profileId };
}

function checkSame(dest: Destination, op: Op) {
  if (op.window !== undefined && op.window !== dest.windowId) throw new OpError("bad_request", `The destination is in window ${dest.windowId}, not ${str(op.window)}.`);
  if (op.profile !== undefined && op.profile !== dest.profileId) throw new OpError("bad_request", `The destination is in profile ${dest.profileId}, not ${str(op.profile)}.`);
}

export function openTabs(urls: string[], windowId: string, profileId: string): string[] {
  const ids = urls.map((url) => store().newTab(windowId, { url, background: true, profileId }));
  if (ids.some((id) => !id)) throw new OpError("failed", "A tab didn't open.");
  const s = store();
  const tabIds = s.windows[windowId]!.tabIds;
  const from = Math.min(...ids.map((id) => tabIds.indexOf(id)));
  if (ids.length > 1) placeEach(ids, { pinned: false, groupId: null, beforeId: nextOutside(s, windowId, profileId, from, new Set(ids)) });
  return ids;
}

function open(results: OpResult[], op: Op): OpResult {
  const group = op.group !== undefined ? groupRef(results, str(op.group)) : undefined;
  if (group && op.pin) throw new OpError("bad_request", "A pinned tile or row can't go into a group; pin the group instead.");
  const dest = destination(results, op, new Set(), group);
  if (dest) checkSame(dest, op);
  const where = dest ?? space(op);
  const ids = openTabs(op.urls as string[], where.windowId, where.profileId);
  if (op.pin) placeEach(ids, { pinned: true, row: op.pin === "row", beforeId: dest?.placement.beforeId ?? null });
  else if (dest) placeEach(ids, dest.placement);
  if (op.activate) store().activate(ids[0]!);
  return { tabs: ids };
}

function moveTabs(results: OpResult[], op: Op): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(ids);
  const group = op.group === undefined ? undefined : op.group === null ? null : groupRef(results, str(op.group));
  const dest = destination(results, op, new Set(ids), group ?? undefined);
  if (dest) checkSame(dest, op);
  const first = store().tabs[ids[0]!]!;
  const where = dest ?? space(op, { windowId: first.windowId, profileId: first.profileId });
  intoSpace(ids, where.windowId, where.profileId);
  if (dest) placeEach(ids, dest.placement);
  else if (group === null) {
    const s = store();
    const before = defaultBefore(s, ids, where.windowId, where.profileId);
    placeEach(ids, { pinned: false, groupId: null, beforeId: before });
  }
  return { tabs: ids };
}

function bySpace(ids: string[]): string[][] {
  const s = store();
  const out = new Map<string, string[]>();
  for (const id of ids) {
    const key = `${s.tabs[id]!.windowId}\u0000${s.tabs[id]!.profileId}`;
    out.set(key, [...(out.get(key) ?? []), id]);
  }
  return [...out.values()];
}

function pin(results: OpResult[], op: Op): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(ids);
  for (const set of bySpace(ids)) store().pinTabs(set, true, op.as === undefined ? undefined : op.as === "row");
  return { tabs: ids };
}

function unpin(results: OpResult[], op: Op): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(ids);
  const s = store();
  const own = ids.filter((id) => s.tabs[id]!.pin);
  const members = ids.filter((id) => !s.tabs[id]!.pin && inPinnedContainer(s, id));
  for (const set of bySpace(own)) store().pinTabs(set, false);
  for (const id of members) {
    const root = rootOf(store().groups, innermostGroupOf(store().groups, id)!.id)!;
    if (groupKeptOpen(root.id)) throw new OpError("refused", `Tab ${id} is in a shared folder; remove it in the sidebar.`);
    store().placeTabs([id], { pinned: false, groupId: null });
  }
  return { tabs: ids };
}

function mute(results: OpResult[], op: Op, muted: boolean): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  for (const id of ids) {
    const s = store();
    const t = s.tabs[id]!;
    if (!muted && isSiteMuted(s, t)) s.setSiteMuted(id, false);
    if (store().tabs[id]!.muted !== muted) store().setMuted([id], muted);
  }
  return { tabs: ids };
}

const isShown = (s: BrowserState, id: string) => {
  const t = s.tabs[id]!;
  return s.windows[t.windowId]?.profileId === t.profileId && activeTabId(s, t.windowId) === id;
};

async function sleep(results: OpResult[], op: Op): Promise<OpResult> {
  const ids = tabRefs(results, op.tabs as string[]);
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    const s = store();
    const t = s.tabs[id];
    if (!t) outcomes[id] = "gone";
    else if (isShown(s, id)) outcomes[id] = "shown";
    else if (inPinnedContainer(s, id)) {
      s.closeTabs([id]);
      outcomes[id] = "asleep";
    } else {
      const view = webviews.get(id);
      const outcome = view ? await view.discard().catch(() => "refused" as const) : "already";
      outcomes[id] = outcome === "discarded" ? "asleep" : outcome;
    }
  }
  return { tabs: ids, outcomes };
}

async function wake(results: OpResult[], op: Op): Promise<OpResult> {
  const ids = tabRefs(results, op.tabs as string[]);
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    const t = store().tabs[id];
    if (!t) outcomes[id] = "gone";
    else if (isSleeping(id) && webviews.get(id)) {
      outcomes[id] = await webviews.get(id)!.reload().then(
        () => "awake",
        () => "failed",
      );
    } else if (needsPage(t)) {
      store().updateTab(id, { page: wokenPage(t) });
      outcomes[id] = "awake";
    } else outcomes[id] = "already";
  }
  return { tabs: ids, outcomes };
}

function rename(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  const t = store().tabs[id]!;
  const name = (op.title as string | null) ?? "";
  store().updateTab(id, { customTitle: name && name !== t.title ? name : null });
  return { tabs: [id] };
}

function tabIcon(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  if (op.icon === NO_GROUP_ICON) throw new OpError("bad_request", "\"none\" is for groups; give null to reset a tab's icon.");
  store().updateTab(id, { customIcon: op.icon as IconValue });
  return { tabs: [id] };
}

function groupPatch(op: Op) {
  return {
    ...(op.name !== undefined ? { name: str(op.name) } : {}),
    ...(op.icon !== undefined ? { icon: op.icon as IconValue } : {}),
    ...(op.color !== undefined ? { color: groupColor(str(op.color)) } : {}),
    ...(op.collapsed !== undefined ? { collapsed: op.collapsed as boolean } : {}),
  };
}

function createGroup(results: OpResult[], op: Op): OpResult {
  const given = op.tabs ? tabRefs(results, op.tabs as string[]) : [];
  organizable(given);
  const tile = given.find((id) => pinSection(store().tabs[id]) === "tile");
  if (tile) throw new OpError("bad_request", `Tab ${tile} is a Top Apps tile; unpin it before grouping it.`);
  const parent = op.parent !== undefined ? groupRef(results, str(op.parent)) : undefined;
  const dest = destination(results, op, new Set(given), parent);
  if (dest) checkSame(dest, op);
  const first = given[0] ? store().tabs[given[0]]! : undefined;
  const where = dest ?? space(op, first && { windowId: first.windowId, profileId: first.profileId });
  const opened = op.urls ? openTabs(op.urls as string[], where.windowId, where.profileId) : [];
  const ids = [...given, ...opened];
  if (!ids.length) ids.push(...openTabs([""], where.windowId, where.profileId));
  const before = dest ? dest.placement.beforeId : parent ? null : defaultBefore(store(), ids, where.windowId, where.profileId);
  intoSpace(ids, where.windowId, where.profileId);
  placeEach(ids, { pinned: false, groupId: parent?.id ?? null, beforeId: before ?? null });
  const pinned = parent ? parent.pinned : op.pinned !== false;
  const id = store().groupTabs(ids, { pinned, name: opt(op.name) });
  if (!id) throw new OpError("failed", "The group couldn't be made.");
  const patch = groupPatch({ ...op, name: undefined });
  if (Object.keys(patch).length) store().updateGroup(id, patch);
  return { group: id, tabs: ids };
}

function keptOpen(g: TabGroup, what: string) {
  if (groupKeptOpen(g.id)) throw new OpError("refused", `Group ${g.id} is a shared folder; ${what} it in the sidebar.`);
}

function regroupedId(g: TabGroup): string {
  const s = store();
  const tab = g.tabIds.find((id) => s.tabs[id]);
  const inner = tab ? innermostGroupOf(s.groups, tab) : undefined;
  const id = inner ? rootOf(s.groups, inner.id)?.id : undefined;
  if (!id) throw new OpError("failed", `Group ${g.id} didn't move.`);
  return id;
}

function moveGroup(results: OpResult[], op: Op): OpResult {
  let g = groupRef(results, str(op.group));
  if (op.profile !== undefined && op.profile !== g.profileId) {
    keptOpen(g, "move");
    store().moveGroupToProfile(g.id, profileOf(str(op.profile)), { background: true });
    g = store().groups[regroupedId(g)]!;
  }
  if (op.window !== undefined && op.window !== g.windowId) {
    if (g.pinned) throw new OpError("refused", `Group ${g.id} is pinned, so it's in every window of its profile.`);
    store().moveGroupToWindow(g.id, normalWindow(str(op.window)), { background: true });
    g = store().groups[regroupedId(g)]!;
  }
  const ref = opt(op.before) ?? opt(op.after);
  if (ref === undefined && op.parent === undefined && op.pinned === undefined) return { group: g.id };
  const parent = op.parent === undefined ? undefined : op.parent === null ? null : groupRef(results, str(op.parent));
  let parentId = parent === undefined ? (g.parentId ?? null) : (parent?.id ?? null);
  let beforeId: string | null | undefined;
  if (ref !== undefined) {
    const anchor = anchorRef(results, ref);
    if (anchor.windowId !== g.windowId || anchor.profileId !== g.profileId) throw new OpError("bad_request", `${ref} is in another window or profile than group ${g.id}.`);
    const dest = besideAnchor(anchor, op.after !== undefined, new Set(g.tabIds), parent);
    beforeId = dest.placement.beforeId;
    if (parent === undefined) parentId = dest.placement.groupId ?? null;
  }
  if (parentId && !canNest(store().groups, g.id, parentId)) throw new OpError("bad_request", `Group ${g.id} can't go inside ${parentId}.`);
  const pinned = parentId ? store().groups[parentId]!.pinned : op.pinned !== undefined ? (op.pinned as boolean) : g.pinned;
  if (!pinned && g.pinned) keptOpen(g, "unpin");
  const before = store().groups;
  store().moveGroup(g.id, { pinned, parentId, beforeId });
  if (store().groups === before && (parentId !== (g.parentId ?? null) || pinned !== g.pinned)) throw new OpError("bad_request", `Group ${g.id} can't move there.`);
  return { group: g.id };
}

function removeGroup(results: OpResult[], op: Op): OpResult {
  const g = groupRef(results, str(op.group));
  keptOpen(g, "remove");
  const tabs = [...g.tabIds];
  if (op.op === "group.ungroup") store().ungroup(g.id);
  else if (op.op === "group.close") store().closeGroup(g.id);
  else store().deleteGroup(g.id);
  return { group: g.id, tabs };
}

export function runOp(results: OpResult[], op: Op): OpResult | Promise<OpResult> {
  switch (op.op) {
    case "open":
      return open(results, op);
    case "tab.move":
      return moveTabs(results, op);
    case "tab.pin":
      return pin(results, op);
    case "tab.unpin":
      return unpin(results, op);
    case "tab.activate": {
      const id = tabRef(results, str(op.tab));
      store().activate(id);
      return { tabs: [id] };
    }
    case "tab.mute":
      return mute(results, op, true);
    case "tab.unmute":
      return mute(results, op, false);
    case "tab.sleep":
      return sleep(results, op);
    case "tab.wake":
      return wake(results, op);
    case "tab.close": {
      const ids = tabRefs(results, op.tabs as string[]);
      store().closeTabs(ids);
      return { tabs: ids };
    }
    case "tab.rename":
      return rename(results, op);
    case "tab.icon":
      return tabIcon(results, op);
    case "group.create":
      return createGroup(results, op);
    case "group.update": {
      const g = groupRef(results, str(op.group));
      store().updateGroup(g.id, groupPatch(op));
      return { group: g.id };
    }
    case "group.move":
      return moveGroup(results, op);
    case "group.ungroup":
    case "group.close":
    case "group.delete":
      return removeGroup(results, op);
  }
}
