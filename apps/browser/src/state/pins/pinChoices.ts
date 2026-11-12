import { Clock, type HLC } from "../../platform/sync";
import { pinKeyOf } from "../browser/model";
import type { BrowserState } from "../browser/store";
import { editClock, editStamp } from "../sync/editClock";
import { isFields, isString } from "../../lib/decode";
import type { SavedObject } from "../../lib/savedDocument";

export type PinChoices = Record<string, Record<string, HLC>>;

export const nextPinChoice = editStamp;
export const groupChoiceKey = (key: string) => `group:${key}`;
export const placeChoiceKey = (key: string) => `place:${key}`;
export const orderChoiceKey = (key: string) => `order:${key}`;
export const tabChoiceKey = (key: string) => key;

export function markPinned(choices: PinChoices, profileId: string, marks: { groups?: readonly string[]; tabs?: readonly string[]; placed?: readonly string[] }): PinChoices {
  const mine = { ...choices[profileId] };
  for (const key of marks.groups ?? []) mine[groupChoiceKey(key)] = nextPinChoice();
  for (const key of marks.tabs ?? []) mine[tabChoiceKey(key)] = nextPinChoice();
  for (const key of marks.placed ?? []) mine[placeChoiceKey(key)] = nextPinChoice();
  return { ...choices, [profileId]: mine };
}

export function notePinChoices(choices: PinChoices) {
  for (const mine of Object.values(choices)) for (const h of Object.values(mine)) editClock().observe(h);
}

const choiceStamp = (choice: unknown) => (typeof choice === "number" ? new Clock("", null, () => choice).tick() : choice);

export const sessionWithPinChoiceStamps = (doc: SavedObject): SavedObject => {
  if (!isFields(doc.pinChoices)) return doc;
  const byProfile = Object.entries(doc.pinChoices).map(([profileId, mine]) => [
    profileId,
    isFields(mine) ? Object.fromEntries(Object.entries(mine).map(([key, choice]) => [key, choiceStamp(choice)]).filter(([, choice]) => isString(choice))) : {},
  ]);
  return { ...doc, pinChoices: Object.fromEntries(byProfile) };
};

export type PinSyncEntry = { g?: string; w?: number };
export type PinSync = Record<string, Record<string, PinSyncEntry>>;

function livePinTable<T>(table: Record<string, Record<string, T>>, s: Pick<BrowserState, "profiles" | "tabs" | "groups" | "parkedPins">): Record<string, Record<string, T>> {
  const profiles = Object.keys(table);
  if (!profiles.length) return table;
  const pinned = new Map<string, Set<string>>();
  const add = (profileId: string, key: string) => {
    let keys = pinned.get(profileId);
    if (!keys) pinned.set(profileId, (keys = new Set()));
    keys.add(key);
  };
  const members = new Set<string>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned) continue;
    add(g.profileId, groupChoiceKey(pinKeyOf(g)));
    add(g.profileId, orderChoiceKey(pinKeyOf(g)));
    for (const id of g.tabIds) members.add(id);
  }
  for (const t of Object.values(s.tabs)) if (t.pin || members.has(t.id)) (add(t.profileId, tabChoiceKey(pinKeyOf(t))), add(t.profileId, placeChoiceKey(pinKeyOf(t))));
  for (const [profileId, park] of Object.entries(s.parkedPins)) {
    for (const p of park.tabs) (add(profileId, p.id), add(profileId, placeChoiceKey(p.id)));
    for (const g of park.groups) {
      add(profileId, groupChoiceKey(g.id));
      add(profileId, orderChoiceKey(g.id));
    }
  }
  let changed = false;
  const out: Record<string, Record<string, T>> = {};
  for (const profileId of profiles) {
    const mine = table[profileId]!;
    const keys = s.profiles[profileId] ? pinned.get(profileId) : undefined;
    const kept = Object.fromEntries(Object.entries(mine).filter(([key]) => keys?.has(key)));
    const n = Object.keys(kept).length;
    if (!n || n !== Object.keys(mine).length) changed = true;
    if (n) out[profileId] = n === Object.keys(mine).length ? mine : (kept as Record<string, T>);
  }
  return changed ? out : table;
}

export function livePinTables(s: BrowserState, prev: BrowserState): Pick<BrowserState, "pinChoices" | "pinSync"> | null {
  if (s.pinChoices === prev.pinChoices && s.pinSync === prev.pinSync && s.tabs === prev.tabs && s.groups === prev.groups && s.parkedPins === prev.parkedPins && s.profiles === prev.profiles) return null;
  const pinChoices = livePinTable(s.pinChoices, s);
  const pinSync = livePinTable(s.pinSync, s);
  return pinChoices !== s.pinChoices || pinSync !== s.pinSync ? { pinChoices, pinSync } : null;
}
