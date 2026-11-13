import { useBrowser, type BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { isIncognitoProfile, isPinnedRow } from "../browser/model";
import { ancestorIds, innermostGroupOf, rootOf } from "../groups/groups";
import type { TabPlacement } from "../pins/placing";
import { groupLabel } from "../pins/tabGrouping";
import type { ErrorCode } from "./automationMethods";
import { eligibleKind, isEligibleTab, lastFocusedEligibleWindow, ownEntry } from "./automationWindows";
import type { GroupName, Op } from "./workspaceOps";
import { iconName, isEligibleGroup } from "./workspaceTree";

export type Changed = { tabs?: string[]; groups?: string[] };

export class OpError extends Error {
  readonly code: ErrorCode;
  changed?: Changed;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type OpResult = { tabs?: string[]; group?: string; label?: string; icon?: string | null; outcomes?: Record<string, string> };

export const store = () => useBrowser.getState();

const refIndex = (ref: string) => (/^\$\d+$/.test(ref) ? Number(ref.slice(1)) : null);

export function tabRefs(results: OpResult[], refs: string[]): string[] {
  const ids = refs.flatMap((ref) => {
    const at = refIndex(ref);
    if (at === null) return [ref];
    const tabs = results[at]?.tabs;
    if (!tabs?.length) throw new OpError("bad_request", `${ref} made no tabs.`);
    return tabs;
  });
  const s = store();
  for (const id of ids) if (!isEligibleTab(s, id)) throw new OpError("no_window", `There's no tab ${id} the ardia command can use.`);
  return [...new Set(ids)];
}

export function tabRef(results: OpResult[], ref: string): string {
  const ids = tabRefs(results, [ref]);
  if (ids.length !== 1) throw new OpError("bad_request", `${ref} made ${ids.length} tabs; name one.`);
  return ids[0]!;
}

export type NameScope = { windowId: string; profileId?: string };

const ANY_SCOPE = (): NameScope => ({ windowId: defaultWindow() });

const folded = (text: string) => text.trim().toLocaleLowerCase();

function groupNamed(name: string, scope: NameScope): TabGroup {
  const s = store();
  const want = folded(name);
  const pool = Object.values(s.groups).filter((g) => isEligibleGroup(s, g.id) && g.windowId === scope.windowId && (!scope.profileId || g.profileId === scope.profileId));
  let found = pool.filter((g) => folded(g.name) === want);
  if (!found.length) found = pool.filter((g) => !g.name.trim() && folded(groupLabel(s, g)) === want);
  const where = `window ${scope.windowId}${scope.profileId ? `, profile ${scope.profileId}` : ""}`;
  if (!found.length) throw new OpError("no_window", `There's no group named ${JSON.stringify(name)} in ${where} (ardia groups lists them; --window picks another window).`);
  if (found.length > 1) {
    const list = found.map((g) => `${g.id} (${JSON.stringify(groupLabel(s, g))}${g.parentId ? `, inside ${g.parentId}` : ""}, profile ${g.profileId})`).join(", ");
    throw new OpError("bad_request", `${JSON.stringify(name)} names ${found.length} groups in ${where}: ${list}. Give one id.`);
  }
  return found[0]!;
}

export function groupRef(results: OpResult[], ref: unknown, scope: () => NameScope = ANY_SCOPE): TabGroup {
  const s = store();
  if (typeof ref === "string") {
    const at = refIndex(ref);
    const id = at === null ? (ownEntry(s.groups, ref) ? ref : null) : results[at]?.group;
    if (at !== null && !id) throw new OpError("bad_request", `${ref} made no group.`);
    if (id) {
      if (!isEligibleGroup(s, id)) throw new OpError("no_window", `There's no group ${id} the ardia command can use.`);
      return ownEntry(s.groups, id)!;
    }
    return groupNamed(ref, scope());
  }
  return groupNamed((ref as GroupName).name, scope());
}

export function labelled(groupId: string): Pick<OpResult, "group" | "label" | "icon"> {
  const s = store();
  const g = ownEntry(s.groups, groupId);
  return g ? { group: groupId, label: groupLabel(s, g), icon: iconName(g.icon) } : { group: groupId };
}

export type Anchor = { kind: "tab" | "group"; id: string; windowId: string; profileId: string };

export function anchorRef(results: OpResult[], ref: string): Anchor {
  const at = refIndex(ref);
  const s = store();
  const group = at === null ? (ownEntry(s.groups, ref) ? ref : null) : (results[at]?.group ?? null);
  if (group) {
    const g = groupRef(results, group);
    return { kind: "group", id: g.id, windowId: g.windowId, profileId: g.profileId };
  }
  const id = tabRef(results, ref);
  const t = ownEntry(s.tabs, id)!;
  return { kind: "tab", id, windowId: t.windowId, profileId: t.profileId };
}

export function normalWindow(id: string): string {
  if (eligibleKind(store(), id) !== "normal") throw new OpError("no_window", `There's no window ${id} the ardia command can use.`);
  return id;
}

export function profileOf(id: string): string {
  if (!ownEntry(store().profiles, id) || isIncognitoProfile(id)) throw new OpError("no_window", `There's no profile ${id}.`);
  return id;
}

const isNormal = (s: BrowserState, id: string) => eligibleKind(s, id) === "normal";

export function defaultWindow(profileId?: string): string {
  const s = store();
  const order = [...s.ui.focusOrder, ...s.windowOrder.filter((id) => !s.ui.focusOrder.includes(id))].filter((id) => isNormal(s, id));
  const showing = profileId ? order.find((id) => s.windows[id]!.profileId === profileId) : undefined;
  const last = lastFocusedEligibleWindow(s);
  const found = showing ?? (last && isNormal(s, last) ? last : order[0]);
  if (!found) throw new OpError("no_window", "No browser window the ardia command can use is open.");
  return found;
}

export type Space = { windowId: string; profileId: string };

export function space(op: Op, fallback?: Space): Space {
  const profileId = op.profile !== undefined ? profileOf(op.profile as string) : undefined;
  if (op.window !== undefined) {
    const windowId = normalWindow(op.window as string);
    return { windowId, profileId: profileId ?? store().windows[windowId]!.profileId };
  }
  if (fallback && (!profileId || profileId === fallback.profileId)) return fallback;
  const windowId = defaultWindow(profileId);
  return { windowId, profileId: profileId ?? store().windows[windowId]!.profileId };
}

export function nextOutside(s: BrowserState, windowId: string, profileId: string, from: number, skip: ReadonlySet<string>): string | null {
  const w = s.windows[windowId];
  if (!w) return null;
  for (let i = from; i < w.tabIds.length; i++) {
    const id = w.tabIds[i]!;
    if (!skip.has(id) && s.tabs[id]?.profileId === profileId) return id;
  }
  return null;
}

export function blockEnd(s: BrowserState, tabId: string): number {
  const w = s.windows[s.tabs[tabId]!.windowId]!;
  const inner = innermostGroupOf(s.groups, tabId);
  const root = inner ? rootOf(s.groups, inner.id) : undefined;
  const last = root ? root.tabIds.reduce((max, id) => Math.max(max, w.tabIds.indexOf(id)), -1) : w.tabIds.indexOf(tabId);
  return last + 1;
}

export type Destination = Space & { placement: TabPlacement; anchor?: Anchor; after?: boolean };

function outermost(s: BrowserState, anchor: Anchor): Anchor {
  const inner = anchor.kind === "group" ? s.groups[anchor.id] : innermostGroupOf(s.groups, anchor.id);
  const root = inner ? rootOf(s.groups, inner.id) : undefined;
  return root ? { ...anchor, kind: "group", id: root.id } : anchor;
}

export function besideAnchor(asked: Anchor, after: boolean, moving: ReadonlySet<string>, group: TabGroup | null | undefined): Destination {
  const s = store();
  const anchor = group === null ? outermost(s, asked) : asked;
  const w = s.windows[anchor.windowId]!;
  let beforeId: string | null;
  let groupId: string | null;
  let pin: Pick<TabPlacement, "pinned" | "row"> = { pinned: false };
  if (anchor.kind === "group") {
    const g = s.groups[anchor.id]!;
    const skip = new Set([...moving, ...g.tabIds]);
    const end = g.tabIds.reduce((max, id) => Math.max(max, w.tabIds.indexOf(id)), -1) + 1;
    const first = w.tabIds.find((id) => g.tabIds.includes(id) && !moving.has(id)) ?? null;
    beforeId = after ? nextOutside(s, w.id, anchor.profileId, end, skip) : first;
    groupId = group ? group.id : group === null ? null : (g.parentId ?? null);
    if (!g.parentId && g.pinned && !group) pin = { pinned: true, row: true };
  } else {
    const t = s.tabs[anchor.id]!;
    if (moving.has(anchor.id)) throw new OpError("bad_request", `Tab ${anchor.id} can't go next to itself.`);
    beforeId = after ? nextOutside(s, w.id, anchor.profileId, w.tabIds.indexOf(anchor.id) + 1, moving) : anchor.id;
    groupId = group ? group.id : group === null ? null : (innermostGroupOf(s.groups, anchor.id)?.id ?? null);
    if (t.pin && !group) pin = { pinned: true, row: isPinnedRow(t) };
  }
  const placement: TabPlacement = pin.pinned ? { ...pin, beforeId } : { pinned: false, groupId, beforeId };
  return { placement, windowId: anchor.windowId, profileId: anchor.profileId, anchor, after };
}

export function insideGroup(s: BrowserState, anchor: Anchor, group: TabGroup): boolean {
  if (anchor.kind === "tab") return group.tabIds.includes(anchor.id);
  return anchor.id !== group.id && ancestorIds(s.groups, anchor.id).includes(group.id);
}

export function destination(results: OpResult[], op: Op, moving: ReadonlySet<string>, group: TabGroup | null | undefined): Destination | null {
  const ref = (op.before ?? op.after) as string | undefined;
  if (ref) {
    const anchor = anchorRef(results, ref);
    if (group && (anchor.windowId !== group.windowId || anchor.profileId !== group.profileId)) {
      throw new OpError("bad_request", `${ref} is in another window or profile than group ${group.id}.`);
    }
    if (group && !insideGroup(store(), anchor, group)) throw new OpError("bad_request", `${ref} isn't inside group ${group.id}.`);
    return besideAnchor(anchor, op.after !== undefined, moving, group);
  }
  if (group) return { placement: { pinned: false, groupId: group.id, beforeId: null }, windowId: group.windowId, profileId: group.profileId };
  return null;
}

export function checkSame(dest: Space, op: Op) {
  if (op.window !== undefined && op.window !== dest.windowId) throw new OpError("bad_request", `The destination is in window ${dest.windowId}, not ${String(op.window)}.`);
  if (op.profile !== undefined && op.profile !== dest.profileId) throw new OpError("bad_request", `The destination is in profile ${dest.profileId}, not ${String(op.profile)}.`);
}
