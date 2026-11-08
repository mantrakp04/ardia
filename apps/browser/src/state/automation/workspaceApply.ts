import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { inPinnedContainer, pinSection } from "../browser/model";
import { descendantIds, innermostGroupOf, rootOf } from "../groups/groups";
import type { TabPlacement } from "../pins/placing";
import { splitOf, splitRowPanes } from "../splits/splits";
import { groupColor, type IconValue, type Op } from "./workspaceOps";
import { closeTabs, mute, rename, sleep, tabIcon, wake } from "./workspaceTabOps";
import {
  afterChange,
  groupSection,
  noSplitTiles,
  closedGroupFor,
  expectBeside,
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
  withPanes,
} from "./workspaceChecks";
import {
  anchorRef,
  besideAnchor,
  blockEnd,
  checkSame,
  destination,
  groupRef,
  labelled,
  nextOutside,
  normalWindow,
  OpError,
  profileOf,
  space,
  store,
  tabRef,
  tabRefs,
  type Changed,
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

function aboveSource(s: BrowserState, ids: string[], where: Space): string | null {
  const first = s.tabs[ids[0]!]!;
  const inner = first.windowId === where.windowId && first.profileId === where.profileId ? innermostGroupOf(s.groups, first.id) : undefined;
  const source = inner ? rootOf(s.groups, inner.id) : undefined;
  const moving = new Set(ids);
  const top = source ? s.windows[where.windowId]!.tabIds.find((id) => source.tabIds.includes(id) && !moving.has(id)) : undefined;
  return top ?? besideOwnGroup(s, ids, where);
}

function besideOwnGroup(s: BrowserState, ids: string[], where: Space): string | null {
  const first = s.tabs[ids[0]!]!;
  if (first.windowId !== where.windowId) return null;
  return nextOutside(s, where.windowId, where.profileId, blockEnd(s, ids[0]!), new Set(ids));
}

export function openTabs(urls: string[], where: Space, created: string[]): string[] {
  const ids: string[] = [];
  for (const url of urls) {
    const id = store().newTab(where.windowId, { url, background: true, profileId: where.profileId });
    if (!id) throw new OpError("refused", `${url || "A New Tab"} didn't open: a tab.opening rule cancelled it, or Ardia refused it.`);
    ids.push(id);
    created.push(id);
  }
  const s = store();
  const tabIds = s.windows[where.windowId]!.tabIds;
  const from = Math.min(...ids.map((id) => tabIds.indexOf(id)));
  if (ids.length > 1) placeEach(ids, { pinned: false, groupId: null, beforeId: nextOutside(s, where.windowId, where.profileId, from, new Set(ids)) });
  return ids;
}

const sectionName = (p: TabPlacement) => (p.pinned ? (p.row ? "pinned rows" : "Top Apps tiles") : p.groupId ? `group ${p.groupId}` : "tabs");

function undoOpen(ids: string[], error: unknown, touched: Changed = {}): never {
  if (!ids.length) {
    if (error instanceof OpError && (touched.tabs?.length || touched.groups?.length)) error.changed = touched;
    throw error;
  }
  const s = store();
  const pinned = ids.filter((id) => s.tabs[id]?.pin);
  if (pinned.length) store().pinTabs(pinned, false);
  for (const id of ids) if (store().tabs[id] && inPinnedContainer(store(), id)) store().placeTabs([id], { pinned: false, groupId: null });
  store().closeTabs(ids.filter((id) => store().tabs[id]));
  const left = ids.filter((id) => store().tabs[id]);
  const opError = error instanceof OpError ? error : new OpError("failed", String(error));
  const undone = left.length ? `; ${left.length} of the tabs it opened are still open: ${left.join(", ")}` : `; it closed the ${ids.length} tab${ids.length === 1 ? "" : "s"} it opened`;
  const out = new OpError(opError.code, opError.message.replace(/\.$/, "") + undone + ".");
  const tabs = [...(touched.tabs ?? []).filter((id) => store().tabs[id]), ...left];
  const groups = (touched.groups ?? []).filter((id) => store().groups[id]);
  if (tabs.length || groups.length) out.changed = { ...(tabs.length ? { tabs } : {}), ...(groups.length ? { groups } : {}) };
  throw out;
}

function open(results: OpResult[], op: Op): OpResult {
  const group = op.group !== undefined ? groupRef(results, op.group, () => ({ windowId: space(op).windowId, profileId: op.profile as string | undefined })) : undefined;
  if (group && op.pin) throw new OpError("bad_request", "A pinned tile or row can't go into a group; pin the group instead.");
  const dest = destination(results, op, new Set(), group);
  if (dest) checkSame(dest, op);
  const asked: TabPlacement | undefined = op.pin ? { pinned: true, row: op.pin === "row", beforeId: dest?.placement.beforeId ?? null } : undefined;
  if (asked && dest && (!dest.placement.pinned || !!dest.placement.row !== asked.row)) {
    throw new OpError("bad_request", `${String(op.before ?? op.after)} is among ${sectionName(dest.placement)}, where a pinned ${op.pin} can't go.`);
  }
  const where = dest ?? space(op);
  const placement = asked ?? dest?.placement;
  const ids: string[] = [];
  try {
    openTabs(op.urls as string[], where, ids);
    if (placement) placeEach(ids, placement);
    expectTabs(ids, where, placement);
    expectBeside(ids, dest?.anchor, dest?.after);
  } catch (error) {
    undoOpen(ids, error);
  }
  if (op.activate) store().activate(ids[0]!);
  return { tabs: ids };
}

function moveTabs(results: OpResult[], op: Op): OpResult {
  const s = store();
  const ids = tabRefs(results, op.tabs as string[]);
  const panes = withPanes(s, ids);
  organizable(s, panes);
  const scope = () => ({ windowId: op.window !== undefined ? normalWindow(str(op.window)) : s.tabs[ids[0]!]!.windowId, profileId: op.profile as string | undefined });
  const group = op.group === undefined ? undefined : op.group === null ? null : groupRef(results, op.group, scope);
  const dest = destination(results, op, new Set(panes), group);
  if (dest) checkSame(dest, op);
  const first = s.tabs[ids[0]!]!;
  const where = dest ?? space(op, { windowId: first.windowId, profileId: first.profileId });
  profileMovable(s, ids, where.profileId);
  noSplitTiles(s, panes, dest?.placement, `next to Top Apps tile ${dest?.anchor?.id}`);
  const placement: TabPlacement | undefined = dest?.placement ?? (group === null ? { pinned: false, groupId: null, beforeId: besideOwnGroup(s, panes, where) } : undefined);
  const leaving = new Set([...leavingTabs(s, ids, where, !!placement), ...(placement ? panes : [])]);
  guardEmptied(s, leaving, placement && !placement.pinned ? withAncestors(s, placement.groupId) : []);
  intoSpace(ids, where);
  if (placement) placeEach(ids, placement);
  afterChange({ tabs: panes }, () => {
    expectTabs(ids, where, placement);
    expectBeside(ids, dest?.anchor, dest?.after);
  });
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
  const panes = withPanes(s, ids);
  organizable(s, panes);
  const row = op.as === undefined ? undefined : op.as === "row";
  noSplitTiles(s, panes, row === false ? { pinned: true, row: false } : undefined, "among Top Apps tiles; pin it as a row");
  guardEmptied(s, new Set(panes));
  for (const set of bySpace(ids)) store().pinTabs(set, true, row);
  afterChange({ tabs: panes }, () => {
    for (const id of panes) expectTabs([id], { windowId: s.tabs[id]!.windowId, profileId: s.tabs[id]!.profileId }, { pinned: true, row });
  });
  return { tabs: ids };
}

function unpin(results: OpResult[], op: Op): OpResult {
  const s = store();
  const ids = tabRefs(results, op.tabs as string[]);
  const panes = withPanes(s, ids);
  organizable(s, panes);
  const own = ids.filter((id) => s.tabs[id]!.pin);
  const members = panes.filter((id) => !s.tabs[id]!.pin && inPinnedContainer(s, id));
  for (const id of members) keptOpen(rootOf(s.groups, innermostGroupOf(s.groups, id)!.id)!, "change");
  guardEmptied(s, new Set(members));
  for (const set of bySpace(own)) store().pinTabs(set, false);
  for (const id of members) store().placeTabs([id], { pinned: false, groupId: null });
  afterChange({ tabs: panes }, () => expectUnpinned(ids));
  return { tabs: ids };
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
  const named = op.tabs ? tabRefs(results, op.tabs as string[]) : [];
  const given = withPanes(s, named);
  organizable(s, given);
  const tile = given.find((id) => pinSection(s.tabs[id]) === "tile");
  if (tile) throw new OpError("bad_request", `Tab ${tile} is a Top Apps tile; unpin it before grouping it.`);
  const scope = () => ({ windowId: op.window !== undefined || !given.length ? space(op).windowId : s.tabs[given[0]!]!.windowId, profileId: op.profile as string | undefined });
  const parent = op.parent !== undefined ? groupRef(results, op.parent, scope) : undefined;
  const dest = destination(results, op, new Set(given), parent) ?? undefined;
  if (dest) checkSame(dest, op);
  const { parentId, pinned } = groupSection(s, dest, { parentId: parent?.id ?? null, pinned: parent ? parent.pinned : true }, op.pinned);
  const first = given[0] ? s.tabs[given[0]]! : undefined;
  const where = dest ?? space(op, first && { windowId: first.windowId, profileId: first.profileId });
  profileMovable(s, given, where.profileId);
  guardEmptied(s, new Set(given), withAncestors(s, parentId));
  const before = dest ? dest.placement.beforeId : parentId || !given.length ? null : aboveSource(s, given, where);
  const created: string[] = [];
  let id = "";
  try {
    if (op.urls) openTabs(op.urls as string[], where, created);
    if (!given.length && !created.length) openTabs([""], where, created);
    const ids = [...given, ...created];
    const beforeId = before ?? (!parentId && !given.length ? besideOwnGroup(store(), ids, where) : null);
    intoSpace(given, where);
    placeEach(ids, dest && pinned && !parentId ? { pinned: true, row: true, beforeId } : { pinned: false, groupId: parentId, beforeId });
    id = store().groupTabs(ids, { pinned, name: op.name as string | undefined });
    if (!id) throw new OpError("failed", "Ardia didn't do that: the group couldn't be made.");
    const patch = groupPatch({ ...op, name: undefined });
    if (Object.keys(patch).length) store().updateGroup(id, patch);
    expectGroup(id, { ...patch, windowId: where.windowId, profileId: where.profileId, pinned, parentId, tabs: ids });
    expectBeside(ids, dest?.anchor, dest?.after);
    return { ...labelled(id), tabs: ids };
  } catch (error) {
    undoOpen(created, error, { tabs: given, groups: id ? [id] : [] });
  }
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
  const asked = groupRef(results, op.group);
  const profileId = op.profile !== undefined ? profileOf(str(op.profile)) : asked.profileId;
  const windowId = op.window !== undefined ? normalWindow(str(op.window)) : asked.windowId;
  const changesProfile = profileId !== asked.profileId;
  const changesWindow = windowId !== asked.windowId;
  if (changesProfile) keptOpen(asked, "move");
  if (changesWindow && asked.pinned) throw new OpError("refused", `Group ${asked.id} is pinned, so it's in every window of its profile.`);
  const parentScope = () => ({ windowId: op.window !== undefined ? normalWindow(str(op.window)) : asked.windowId, profileId: (op.profile as string | undefined) ?? asked.profileId });
  const parent = op.parent === undefined ? undefined : op.parent === null ? null : groupRef(results, op.parent, parentScope);
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
  const dest = anchor ? besideAnchor(anchor, op.after !== undefined, new Set(asked.tabIds), parent) : undefined;
  const fallbackParent = parent === undefined ? (asked.parentId ?? null) : (parent?.id ?? null);
  const { parentId, pinned } = groupSection(s, dest, { parentId: fallbackParent, pinned: fallbackParent ? s.groups[fallbackParent]!.pinned : asked.pinned }, op.pinned, own);
  if (parentId) keptOpen(asked, "nest");
  if (!pinned && asked.pinned) keptOpen(asked, "unpin");
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
  const moved = g.id;
  if (anchor === undefined && parent === undefined && op.pinned === undefined) {
    afterChange({ groups: [moved] }, () => expectGroup(moved, { windowId, profileId }));
    return labelled(moved);
  }
  store().moveGroup(g.id, { pinned, parentId, beforeId: dest?.placement.beforeId });
  afterChange({ groups: [moved] }, () => {
    expectGroup(moved, { windowId, profileId, parentId, pinned });
    expectBeside(store().groups[moved]!.tabIds, dest?.anchor, dest?.after);
  });
  return labelled(moved);
}

function removeGroup(results: OpResult[], op: Op): OpResult {
  const s = store();
  const g = groupRef(results, op.group);
  keptOpen(g, "remove");
  const target = op.op === "group.ungroup" ? g : closedGroupFor(s, g);
  const named = labelled(target.id);
  keptOpen(target, "remove");
  if (op.op !== "group.ungroup") guardEmptied(s, new Set(target.tabIds));
  const tabs = [...target.tabIds];
  if (op.op === "group.ungroup") store().ungroup(g.id);
  else if (op.op === "group.close") store().closeGroup(g.id);
  else store().deleteGroup(g.id);
  expectGone(target.id);
  return { ...named, tabs };
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
      const g = groupRef(results, op.group);
      const patch = groupPatch(op);
      store().updateGroup(g.id, patch);
      expectGroup(g.id, patch);
      return labelled(g.id);
    }
    case "group.move":
      return moveGroup(results, op);
    case "group.ungroup":
    case "group.close":
    case "group.delete":
      return removeGroup(results, op);
  }
}
