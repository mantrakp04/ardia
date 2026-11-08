import { useBrowser, type BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { isIncognitoProfile, isPinnedRow } from "../browser/model";
import { innermostGroupOf, rootOf } from "../groups/groups";
import type { TabPlacement } from "../pins/placing";
import type { ErrorCode } from "./automationMethods";
import { eligibleKind, isEligibleTab, lastFocusedEligibleWindow } from "./automationWindows";
import { isEligibleGroup } from "./workspaceTree";

export class OpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type OpResult = { tabs?: string[]; group?: string; outcomes?: Record<string, string> };

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

export function groupRef(results: OpResult[], ref: string): TabGroup {
  const at = refIndex(ref);
  const id = at === null ? ref : results[at]?.group;
  if (!id) throw new OpError("bad_request", `${ref} made no group.`);
  const s = store();
  if (!isEligibleGroup(s, id)) throw new OpError("no_window", `There's no group ${id} the ardia command can use.`);
  return s.groups[id]!;
}

export type Anchor = { kind: "tab"; id: string; windowId: string; profileId: string } | { kind: "group"; id: string; windowId: string; profileId: string };

export function anchorRef(results: OpResult[], ref: string): Anchor {
  const at = refIndex(ref);
  const s = store();
  const group = at === null ? (s.groups[ref] ? ref : null) : (results[at]?.group ?? null);
  if (group) {
    const g = groupRef(results, group);
    return { kind: "group", id: g.id, windowId: g.windowId, profileId: g.profileId };
  }
  const id = tabRef(results, ref);
  const t = s.tabs[id]!;
  return { kind: "tab", id, windowId: t.windowId, profileId: t.profileId };
}

export function normalWindow(id: string): string {
  if (eligibleKind(store(), id) !== "normal") throw new OpError("no_window", `There's no window ${id} the ardia command can use.`);
  return id;
}

export function profileOf(id: string): string {
  const s = store();
  if (!s.profiles[id] || isIncognitoProfile(id)) throw new OpError("no_window", `There's no profile ${id}.`);
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

export type Destination = { placement: TabPlacement; windowId: string; profileId: string };

export function besideAnchor(anchor: Anchor, after: boolean, moving: ReadonlySet<string>, group: TabGroup | null | undefined): Destination {
  const s = store();
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
    groupId = group === undefined ? (g.parentId ?? null) : (group?.id ?? null);
    if (!g.parentId && g.pinned && group === undefined) pin = { pinned: true, row: true };
  } else {
    const t = s.tabs[anchor.id]!;
    if (moving.has(anchor.id)) throw new OpError("bad_request", `Tab ${anchor.id} can't go next to itself.`);
    beforeId = after ? nextOutside(s, w.id, anchor.profileId, w.tabIds.indexOf(anchor.id) + 1, moving) : anchor.id;
    groupId = group === undefined ? (innermostGroupOf(s.groups, anchor.id)?.id ?? null) : (group?.id ?? null);
    if (t.pin && group === undefined) pin = { pinned: true, row: isPinnedRow(t) };
  }
  return { placement: pin.pinned ? { ...pin, beforeId } : { pinned: false, groupId, beforeId }, windowId: anchor.windowId, profileId: anchor.profileId };
}
