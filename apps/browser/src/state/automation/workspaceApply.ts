import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { inPinnedContainer, pinSection } from "../browser/model";
import { descendantIds, innermostGroupOf, rootOf } from "../groups/groups";
import { NO_GROUP_ICON } from "../groups/groupIcons";
import type { TabPlacement } from "../pins/placing";
import { withSharedFamily } from "../pins/pinShare";
import { splitOf, splitTabIdsOf, withPinnedPanes } from "../splits/splits";
import { isSiteMuted } from "../tabs/mute";
import { needsPage, wokenPage } from "../tabs/pageSession";
import { shownTabIds } from "../tabs/shownTabs";
import { isSleeping } from "../tabs/sleepingTabs";
import { webviews } from "../../platform/webviews";
import { groupColor, type IconValue, type Op } from "./workspaceOps";
import {
  closedGroupFor,
  expectGone,
  expectGroup,
  expectTabs,
  expectUnpinned,
  guardEmptied,
  keptOpen,
  leavingTabs,
  organizable,
  profileMovable,
  withAncestors,
  withDescendants,
} from "./workspaceChecks";
import {
  anchorRef,
  besideAnchor,
  blockEnd,
  checkSame,
  destination,
  groupRef,
  nextOutside,
  normalWindow,
  OpError,
  profileOf,
  space,
  store,
  tabRef,
  tabRefs,
  type OpResult,
  type Space,
} from "./workspaceTargets";

const str = (v: unknown) => v as string;

function intoSpace(ids: string[], where: Space) {
  for (const id of ids) if (store().tabs[id]!.profileId !== where.profileId) store().moveTabToProfile(id, where.profileId, { background: true });
  const away = ids.filter((id) => store().tabs[id]!.windowId !== where.windowId);
  if (away.length) store().moveTabsToWindow(away, where.windowId, { background: true });
}

function placeEach(ids: string[], placement: TabPlacement) {
  for (const id of ids) store().placeTabs([id], placement);
}

function besideOwnGroup(s: BrowserState, ids: string[], where: Space): string | null {
  const first = s.tabs[ids[0]!]!;
  if (first.windowId !== where.windowId) return null;
  return nextOutside(s, where.windowId, where.profileId, blockEnd(s, ids[0]!), new Set(ids));
}

export function openTabs(urls: string[], where: Space): string[] {
  const ids = urls.map((url) => store().newTab(where.windowId, { url, background: true, profileId: where.profileId }));
  if (ids.some((id) => !id)) throw new OpError("failed", "A tab didn't open.");
  const s = store();
  const tabIds = s.windows[where.windowId]!.tabIds;
  const from = Math.min(...ids.map((id) => tabIds.indexOf(id)));
  if (ids.length > 1) placeEach(ids, { pinned: false, groupId: null, beforeId: nextOutside(s, where.windowId, where.profileId, from, new Set(ids)) });
  return ids;
}

function open(results: OpResult[], op: Op): OpResult {
  const group = op.group !== undefined ? groupRef(results, str(op.group)) : undefined;
  if (group && op.pin) throw new OpError("bad_request", "A pinned tile or row can't go into a group; pin the group instead.");
  const dest = destination(results, op, new Set(), group);
  if (dest) checkSame(dest, op);
  const where = dest ?? space(op);
  const placement: TabPlacement | undefined = op.pin ? { pinned: true, row: op.pin === "row", beforeId: dest?.placement.beforeId ?? null } : dest?.placement;
  const ids = openTabs(op.urls as string[], where);
  if (placement) placeEach(ids, placement);
  if (op.activate) store().activate(ids[0]!);
  expectTabs(ids, where, placement);
  return { tabs: ids };
}

function moveTabs(results: OpResult[], op: Op): OpResult {
  const s = store();
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(s, ids);
  const group = op.group === undefined ? undefined : op.group === null ? null : groupRef(results, str(op.group));
  const dest = destination(results, op, new Set(ids), group);
  if (dest) checkSame(dest, op);
  const first = s.tabs[ids[0]!]!;
  const where = dest ?? space(op, { windowId: first.windowId, profileId: first.profileId });
  profileMovable(s, ids, where.profileId);
  const placement: TabPlacement | undefined = dest?.placement ?? (group === null ? { pinned: false, groupId: null, beforeId: besideOwnGroup(s, ids, where) } : undefined);
  guardEmptied(s, leavingTabs(s, ids, where, !!placement), placement && !placement.pinned ? withAncestors(s, placement.groupId) : []);
  intoSpace(ids, where);
  if (placement) placeEach(ids, placement);
  expectTabs(ids, where, placement);
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
  const s = store();
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(s, ids);
  guardEmptied(s, new Set(ids));
  const row = op.as === undefined ? undefined : op.as === "row";
  for (const set of bySpace(ids)) store().pinTabs(set, true, row);
  for (const id of ids) expectTabs([id], { windowId: s.tabs[id]!.windowId, profileId: s.tabs[id]!.profileId }, { pinned: true, row });
  return { tabs: ids };
}

function unpin(results: OpResult[], op: Op): OpResult {
  const s = store();
  const ids = tabRefs(results, op.tabs as string[]);
  organizable(s, ids);
  const own = ids.filter((id) => s.tabs[id]!.pin);
  const members = ids.filter((id) => !s.tabs[id]!.pin && inPinnedContainer(s, id));
  for (const id of members) keptOpen(rootOf(s.groups, innermostGroupOf(s.groups, id)!.id)!, "change");
  guardEmptied(s, new Set(members));
  for (const set of bySpace(own)) store().pinTabs(set, false);
  for (const id of members) store().placeTabs([id], { pinned: false, groupId: null });
  expectUnpinned(ids);
  return { tabs: ids };
}

function mute(results: OpResult[], op: Op, muted: boolean): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  for (const id of ids) {
    const s = store();
    if (!muted && isSiteMuted(s, s.tabs[id]!)) s.setSiteMuted(id, false);
    if (store().tabs[id]!.muted !== muted) store().setMuted([id], muted);
    if (store().tabs[id]?.muted !== muted) throw new OpError("failed", `Ardia didn't do that: tab ${id} isn't ${muted ? "muted" : "unmuted"}.`);
  }
  return { tabs: ids };
}

function visibleWith(s: BrowserState, id: string): boolean {
  const shown = shownTabIds(s);
  const family = withSharedFamily(s, withPinnedPanes(s, [id]));
  return family.some((x) => shown.has(x) || (splitTabIdsOf(splitOf(s, x)) ?? []).some((pane) => shown.has(pane)));
}

async function sleep(results: OpResult[], op: Op): Promise<OpResult> {
  const ids = tabRefs(results, op.tabs as string[]);
  const outcomes: Record<string, string> = {};
  for (const id of ids) {
    const s = store();
    if (!s.tabs[id]) outcomes[id] = "gone";
    else if (visibleWith(s, id)) outcomes[id] = "shown";
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

function closeTabs(results: OpResult[], op: Op): OpResult {
  const ids = tabRefs(results, op.tabs as string[]);
  store().closeTabs(ids);
  const s = store();
  const left = ids.find((id) => s.tabs[id] && !inPinnedContainer(s, id));
  if (left) throw new OpError("failed", `Ardia didn't do that: tab ${left} is still open.`);
  return { tabs: ids };
}

function rename(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  const t = store().tabs[id]!;
  const name = (op.title as string | null) ?? "";
  const customTitle = name && name !== t.title ? name : null;
  store().updateTab(id, { customTitle });
  if (store().tabs[id]?.customTitle !== customTitle) throw new OpError("failed", `Ardia didn't do that: tab ${id} wasn't renamed.`);
  return { tabs: [id] };
}

function tabIcon(results: OpResult[], op: Op): OpResult {
  const id = tabRef(results, str(op.tab));
  if (op.icon === NO_GROUP_ICON) throw new OpError("bad_request", "\"none\" is for groups; give null to reset a tab's icon.");
  store().updateTab(id, { customIcon: op.icon as IconValue });
  if (store().tabs[id]?.customIcon !== op.icon) throw new OpError("failed", `Ardia didn't do that: tab ${id}'s icon didn't change.`);
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
  const s = store();
  const given = op.tabs ? tabRefs(results, op.tabs as string[]) : [];
  organizable(s, given);
  const tile = given.find((id) => pinSection(s.tabs[id]) === "tile");
  if (tile) throw new OpError("bad_request", `Tab ${tile} is a Top Apps tile; unpin it before grouping it.`);
  const parent = op.parent !== undefined ? groupRef(results, str(op.parent)) : undefined;
  const dest = destination(results, op, new Set(given), parent);
  if (dest) checkSame(dest, op);
  const first = given[0] ? s.tabs[given[0]]! : undefined;
  const where = dest ?? space(op, first && { windowId: first.windowId, profileId: first.profileId });
  guardEmptied(s, new Set(given), withAncestors(s, parent?.id));
  const before = dest ? dest.placement.beforeId : parent || !given.length ? null : besideOwnGroup(s, given, where);
  const opened = op.urls ? openTabs(op.urls as string[], where) : [];
  const ids = [...given, ...opened];
  if (!ids.length) ids.push(...openTabs([""], where));
  const beforeId = before ?? (!parent && !given.length ? besideOwnGroup(store(), ids, where) : null);
  intoSpace(ids, where);
  placeEach(ids, { pinned: false, groupId: parent?.id ?? null, beforeId });
  const pinned = parent ? parent.pinned : op.pinned !== false;
  const id = store().groupTabs(ids, { pinned, name: op.name as string | undefined });
  if (!id) throw new OpError("failed", "Ardia didn't do that: the group couldn't be made.");
  const patch = groupPatch({ ...op, name: undefined });
  if (Object.keys(patch).length) store().updateGroup(id, patch);
  expectGroup(id, { ...patch, windowId: where.windowId, profileId: where.profileId, pinned, parentId: parent?.id ?? null, tabs: ids });
  return { group: id, tabs: ids };
}

function regroupedId(g: TabGroup): string {
  const s = store();
  const tab = g.tabIds.find((id) => s.tabs[id]);
  const inner = tab ? innermostGroupOf(s.groups, tab) : undefined;
  const id = inner ? rootOf(s.groups, inner.id)?.id : undefined;
  if (!id) throw new OpError("failed", `Ardia didn't do that: group ${g.id} didn't move.`);
  return id;
}

function moveGroup(results: OpResult[], op: Op): OpResult {
  const s = store();
  const asked = groupRef(results, str(op.group));
  const profileId = op.profile !== undefined ? profileOf(str(op.profile)) : asked.profileId;
  const windowId = op.window !== undefined ? normalWindow(str(op.window)) : asked.windowId;
  const changesProfile = profileId !== asked.profileId;
  const changesWindow = windowId !== asked.windowId;
  if (changesProfile) keptOpen(asked, "move");
  if (changesWindow && asked.pinned) throw new OpError("refused", `Group ${asked.id} is pinned, so it's in every window of its profile.`);
  const parent = op.parent === undefined ? undefined : op.parent === null ? null : groupRef(results, str(op.parent));
  const ref = (op.before ?? op.after) as string | undefined;
  const anchor = ref !== undefined ? anchorRef(results, ref) : undefined;
  for (const [what, place] of [["parent", parent], ["anchor", anchor]] as const) {
    if (place && (place.windowId !== windowId || place.profileId !== profileId)) throw new OpError("bad_request", `The ${what} is in another window or profile than group ${asked.id} would be.`);
  }
  const own = new Set(withDescendants(s, asked.id));
  if (parent && own.has(parent.id)) throw new OpError("bad_request", `Group ${asked.id} can't go inside ${parent.id}.`);
  if (anchor && ((anchor.kind === "group" && own.has(anchor.id)) || (anchor.kind === "tab" && asked.tabIds.includes(anchor.id)))) {
    throw new OpError("bad_request", `${ref} is inside group ${asked.id}.`);
  }
  if (parent && anchor && !(anchor.kind === "tab" ? parent.tabIds.includes(anchor.id) : anchor.id !== parent.id && descendantIds(s.groups, parent.id).includes(anchor.id))) {
    throw new OpError("bad_request", `${ref} isn't inside group ${parent.id}.`);
  }
  if (parent) keptOpen(asked, "nest");
  if (op.pinned === false && asked.pinned) keptOpen(asked, "unpin");
  if (changesProfile || changesWindow) guardEmptied(s, new Set(asked.tabIds), own);
  let g = asked;
  if (changesProfile) {
    store().moveGroupToProfile(g.id, profileId, { background: true });
    g = store().groups[regroupedId(g)]!;
  }
  if (changesWindow) {
    store().moveGroupToWindow(g.id, windowId, { background: true });
    g = store().groups[regroupedId(g)]!;
  }
  if (anchor === undefined && parent === undefined && op.pinned === undefined) {
    expectGroup(g.id, { windowId, profileId });
    return { group: g.id };
  }
  let parentId = parent === undefined ? (g.parentId ?? null) : (parent?.id ?? null);
  let beforeId: string | null | undefined;
  if (anchor) {
    const dest = besideAnchor(anchor, op.after !== undefined, new Set(g.tabIds), parent);
    beforeId = dest.placement.beforeId;
    if (parent === undefined) parentId = dest.placement.pinned ? null : (dest.placement.groupId ?? null);
  }
  if (parentId) keptOpen(g, "nest");
  const pinned = parentId ? store().groups[parentId]!.pinned : op.pinned !== undefined ? (op.pinned as boolean) : g.pinned;
  store().moveGroup(g.id, { pinned, parentId, beforeId });
  expectGroup(g.id, { windowId, profileId, parentId, pinned });
  return { group: g.id };
}

function removeGroup(results: OpResult[], op: Op): OpResult {
  const s = store();
  const g = groupRef(results, str(op.group));
  keptOpen(g, "remove");
  const target = op.op === "group.ungroup" ? g : closedGroupFor(s, g);
  keptOpen(target, "remove");
  if (op.op !== "group.ungroup") guardEmptied(s, new Set(target.tabIds));
  const tabs = [...target.tabIds];
  if (op.op === "group.ungroup") store().ungroup(g.id);
  else if (op.op === "group.close") store().closeGroup(g.id);
  else store().deleteGroup(g.id);
  expectGone(target.id);
  return { group: target.id, tabs };
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
    case "tab.close":
      return closeTabs(results, op);
    case "tab.rename":
      return rename(results, op);
    case "tab.icon":
      return tabIcon(results, op);
    case "group.create":
      return createGroup(results, op);
    case "group.update": {
      const g = groupRef(results, str(op.group));
      const patch = groupPatch(op);
      store().updateGroup(g.id, patch);
      expectGroup(g.id, patch);
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
