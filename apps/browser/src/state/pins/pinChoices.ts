import type { HLC } from "../../platform/sync";
import { pinKeyOf } from "../browser/model";
import type { BrowserState } from "../browser/store";
import { editClock, editStamp } from "../sync/editClock";

export type PinChoices = Record<string, Record<string, HLC>>;

export const nextPinChoice = editStamp;
export const groupChoiceKey = (key: string) => `group:${key}`;
export const placeChoiceKey = (key: string) => `place:${key}`;
export const orderChoiceKey = (key: string) => `order:${key}`;
export const tabChoiceKey = (key: string) => key;

export function markPinned(choices: PinChoices, spaceId: string, marks: { groups?: readonly string[]; tabs?: readonly string[]; placed?: readonly string[] }): PinChoices {
  const mine = { ...choices[spaceId] };
  for (const key of marks.groups ?? []) mine[groupChoiceKey(key)] = nextPinChoice();
  for (const key of marks.tabs ?? []) mine[tabChoiceKey(key)] = nextPinChoice();
  for (const key of marks.placed ?? []) mine[placeChoiceKey(key)] = nextPinChoice();
  return { ...choices, [spaceId]: mine };
}

export function notePinChoices(choices: PinChoices) {
  for (const mine of Object.values(choices)) for (const h of Object.values(mine)) editClock().observe(h);
}

export { sessionWithPinChoiceStamps } from "../../lib/sessionPinChoicesUpgrade";

export type PinSyncEntry = { g?: string; w?: number };
export type PinSync = Record<string, Record<string, PinSyncEntry>>;

function livePinTable<T>(table: Record<string, Record<string, T>>, s: Pick<BrowserState, "spaces" | "tabs" | "groups" | "parkedPins">): Record<string, Record<string, T>> {
  const spaces = Object.keys(table);
  if (!spaces.length) return table;
  const pinned = new Map<string, Set<string>>();
  const add = (spaceId: string, key: string) => {
    let keys = pinned.get(spaceId);
    if (!keys) pinned.set(spaceId, (keys = new Set()));
    keys.add(key);
  };
  const members = new Set<string>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned) continue;
    add(g.spaceId, groupChoiceKey(pinKeyOf(g)));
    add(g.spaceId, orderChoiceKey(pinKeyOf(g)));
    for (const id of g.tabIds) members.add(id);
  }
  for (const t of Object.values(s.tabs)) if (t.pin || members.has(t.id)) (add(t.spaceId, tabChoiceKey(pinKeyOf(t))), add(t.spaceId, placeChoiceKey(pinKeyOf(t))));
  for (const [spaceId, park] of Object.entries(s.parkedPins)) {
    for (const p of park.tabs) (add(spaceId, p.id), add(spaceId, placeChoiceKey(p.id)));
    for (const g of park.groups) {
      add(spaceId, groupChoiceKey(g.id));
      add(spaceId, orderChoiceKey(g.id));
    }
  }
  let changed = false;
  const out: Record<string, Record<string, T>> = {};
  for (const spaceId of spaces) {
    const mine = table[spaceId]!;
    const keys = s.spaces[spaceId] ? pinned.get(spaceId) : undefined;
    const kept = Object.fromEntries(Object.entries(mine).filter(([key]) => keys?.has(key)));
    const n = Object.keys(kept).length;
    if (!n || n !== Object.keys(mine).length) changed = true;
    if (n) out[spaceId] = n === Object.keys(mine).length ? mine : (kept as Record<string, T>);
  }
  return changed ? out : table;
}

export function livePinTables(s: BrowserState, prev: BrowserState): Pick<BrowserState, "pinChoices" | "pinSync"> | null {
  if (s.pinChoices === prev.pinChoices && s.pinSync === prev.pinSync && s.tabs === prev.tabs && s.groups === prev.groups && s.parkedPins === prev.parkedPins && s.spaces === prev.spaces) return null;
  const pinChoices = livePinTable(s.pinChoices, s);
  const pinSync = livePinTable(s.pinSync, s);
  return pinChoices !== s.pinChoices || pinSync !== s.pinSync ? { pinChoices, pinSync } : null;
}
