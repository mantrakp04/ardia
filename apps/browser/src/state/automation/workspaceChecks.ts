import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { inPinnedContainer, isPinnedRow, pinSection } from "../browser/model";
import { ancestorIds, descendantIds, innermostGroupOf } from "../groups/groups";
import { groupKeptOpen } from "../groups/closeGuard";
import type { TabPlacement } from "../pins/placing";
import { splitOf, splitRowPanes, withSplitRows } from "../splits/splits";
import { eligibleKind, isEligibleTab, ownEntry } from "./automationWindows";
import { OpError, store, type Anchor, type Changed, type Destination, type Space } from "./workspaceTargets";

export function keptOpen(g: TabGroup, what: string) {
  if (groupKeptOpen(g.id)) throw new OpError("refused", `Group ${g.id} is a shared folder; ${what} it in the sidebar.`);
}

export function guardEmptied(s: BrowserState, leaving: ReadonlySet<string>, staying: Iterable<string> = []) {
  if (!leaving.size) return;
  const keep = new Set(staying);
  for (const g of Object.values(s.groups)) {
    if (keep.has(g.id) || !groupKeptOpen(g.id) || !g.tabIds.length || !g.tabIds.every((id) => leaving.has(id))) continue;
    throw new OpError("refused", `That would empty shared folder ${g.id}; change it in the sidebar.`);
  }
}

export const withAncestors = (s: BrowserState, id: string | null | undefined): string[] => (id ? [id, ...ancestorIds(s.groups, id)] : []);

export const withDescendants = (s: BrowserState, id: string): string[] => [id, ...descendantIds(s.groups, id)];

export function closedGroupFor(s: BrowserState, g: TabGroup): TabGroup {
  let target = g;
  for (let p = target.parentId ? s.groups[target.parentId] : undefined; p?.tabIds.length === target.tabIds.length; p = p.parentId ? s.groups[p.parentId] : undefined) target = p;
  return target;
}

export function withPanes(s: BrowserState, ids: string[]): string[] {
  const all = withSplitRows(s, ids);
  for (const id of all) if (!isEligibleTab(s, id)) throw new OpError("no_window", `Tab ${id}, in a split with the tabs named, isn't one the ardia command can use.`);
  return all;
}

export function afterChange<T>(changed: Changed, check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof OpError) error.changed = changed;
    throw error;
  }
}

export function expectBeside(ids: string[], anchor: Anchor | undefined, after: boolean | undefined) {
  if (!anchor) return;
  const s = store();
  const order = s.windows[anchor.windowId]?.tabIds ?? [];
  const moving = new Set(ids);
  const marks = (anchor.kind === "tab" ? [anchor.id] : (s.groups[anchor.id]?.tabIds ?? [])).filter((id) => !moving.has(id)).map((id) => order.indexOf(id));
  if (!marks.length) return;
  const edge = after ? Math.max(...marks) : Math.min(...marks);
  const off = ids.find((id) => (after ? order.indexOf(id) <= edge : order.indexOf(id) >= edge));
  if (off) fail(`tab ${off} isn't ${after ? "after" : "before"} ${anchor.id}.`);
}

export function noSplitTiles(s: BrowserState, panes: string[], placement: TabPlacement | undefined, where: string) {
  if (!placement?.pinned || placement.row !== false) return;
  const paired = panes.find((id) => splitRowPanes(s, splitOf(s, id)).includes(id));
  if (paired) throw new OpError("bad_request", `Tab ${paired} is in a split, whose panes pin together as rows, so it can't go ${where}.`);
}

export type GroupSection = { parentId: string | null; pinned: boolean };

export function groupSection(s: BrowserState, dest: Destination | undefined, fallback: GroupSection, askedPinned: unknown, own: ReadonlySet<string> = new Set()): GroupSection {
  const ref = dest?.anchor?.id;
  if (dest?.placement.pinned && !dest.placement.row) throw new OpError("bad_request", `${ref} is a Top Apps tile; groups don't go among tiles.`);
  const parentId = dest ? (dest.placement.pinned ? null : (dest.placement.groupId ?? null)) : fallback.parentId;
  if (parentId && own.has(parentId)) throw new OpError("bad_request", `A group can't go inside itself (${parentId}).`);
  const sectionPinned = parentId ? s.groups[parentId]!.pinned : dest ? dest.placement.pinned : undefined;
  if (sectionPinned !== undefined && askedPinned !== undefined && askedPinned !== sectionPinned) {
    throw new OpError("bad_request", `${ref ?? parentId} is ${sectionPinned ? "in" : "outside"} the pinned section, so the group can't be ${askedPinned ? "pinned" : "unpinned"} there.`);
  }
  return { parentId, pinned: sectionPinned ?? (askedPinned !== undefined ? (askedPinned as boolean) : fallback.pinned) };
}

export function organizable(s: BrowserState, ids: string[]) {
  for (const id of ids) if (eligibleKind(s, s.tabs[id]!.windowId) !== "normal") throw new OpError("bad_request", `Tab ${id} is in Little Ardia, which holds one tab.`);
}

export function profileMovable(s: BrowserState, ids: string[], profileId: string) {
  const tile = ids.find((id) => s.tabs[id]!.profileId !== profileId && pinSection(s.tabs[id]) === "tile");
  if (tile) throw new OpError("bad_request", `Tab ${tile} is a Top Apps tile, which stays with its profile.`);
}

export function leavingTabs(s: BrowserState, ids: string[], where: Space, placed: boolean): Set<string> {
  return new Set(ids.filter((id) => placed || s.tabs[id]!.windowId !== where.windowId || s.tabs[id]!.profileId !== where.profileId));
}

const fail = (message: string): never => {
  throw new OpError("failed", `Ardia didn't do that: ${message}`);
};

const indexIn = (s: BrowserState, id: string) => s.windows[s.tabs[id]?.windowId ?? ""]?.tabIds.indexOf(id) ?? -1;

export function expectTabs(ids: string[], where: Space, placement?: TabPlacement) {
  const s = store();
  for (const id of ids) {
    const t = ownEntry(s.tabs, id);
    if (!t) fail(`tab ${id} is gone.`);
    if (t!.windowId !== where.windowId || t!.profileId !== where.profileId) fail(`tab ${id} isn't in window ${where.windowId}, profile ${where.profileId}.`);
    if (!placement) continue;
    if (placement.pinned) {
      if (!t!.pin || (placement.row !== undefined && isPinnedRow(t) !== placement.row)) fail(`tab ${id} isn't pinned as asked.`);
    } else if (placement.groupId !== undefined) {
      const inGroup = placement.groupId ? !!s.groups[placement.groupId]?.tabIds.includes(id) : !innermostGroupOf(s.groups, id);
      if (!inGroup || t!.pin) fail(placement.groupId ? `tab ${id} isn't in group ${placement.groupId}.` : `tab ${id} is still in a group.`);
    }
    if (placement.beforeId && s.tabs[placement.beforeId] && indexIn(s, id) > indexIn(s, placement.beforeId)) fail(`tab ${id} isn't before ${placement.beforeId}.`);
  }
}

export function expectGroup(id: string, fields: Partial<Pick<TabGroup, "windowId" | "profileId" | "pinned" | "name" | "icon" | "color" | "collapsed">> & { parentId?: string | null; tabs?: string[] }) {
  const g = ownEntry(store().groups, id);
  if (!g) return fail(`group ${id} is gone.`);
  const { parentId, tabs, ...rest } = fields;
  for (const [key, value] of Object.entries(rest)) if (value !== undefined && g[key as keyof TabGroup] !== value) fail(`group ${id}'s ${key} isn't what was asked.`);
  if (parentId !== undefined && (g.parentId ?? null) !== parentId) fail(`group ${id} isn't inside ${parentId ?? "the top level"}.`);
  if (tabs && !tabs.every((t) => g.tabIds.includes(t))) fail(`group ${id} doesn't hold every tab asked.`);
}

export function expectGone(id: string) {
  if (ownEntry(store().groups, id)) fail(`group ${id} is still there.`);
}

export function expectUnpinned(ids: string[]) {
  const s = store();
  for (const id of ids) if (inPinnedContainer(s, id)) fail(`tab ${id} is still pinned.`);
}
