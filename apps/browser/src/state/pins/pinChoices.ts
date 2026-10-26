import type { BrowserState } from "../browser/store";

export type PinChoices = Record<string, Record<string, number>>;

let lastPinChoice = 0;
export const nextPinChoice = () => (lastPinChoice = Math.max(Date.now(), lastPinChoice + 1));
export const groupChoiceKey = (key: string) => `group:${key}`;
export const placeChoiceKey = (key: string) => `place:${key}`;
export const orderChoiceKey = (key: string) => `order:${key}`;

export function notePinChoices(choices: PinChoices) {
  for (const mine of Object.values(choices)) for (const n of Object.values(mine)) if (n > lastPinChoice) lastPinChoice = n;
}

export type PinSyncEntry = { g?: string; w?: number };
export type PinSync = Record<string, Record<string, PinSyncEntry>>;

export function livePinTable<T>(table: Record<string, Record<string, T>>, s: Pick<BrowserState, "profiles" | "tabs" | "groups" | "parkedPins">): Record<string, Record<string, T>> {
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
    add(g.profileId, groupChoiceKey(g.pinKey ?? g.id));
    add(g.profileId, orderChoiceKey(g.pinKey ?? g.id));
    for (const id of g.tabIds) members.add(id);
  }
  for (const t of Object.values(s.tabs)) if (t.pinned || members.has(t.id)) (add(t.profileId, t.pinKey ?? t.id), add(t.profileId, placeChoiceKey(t.pinKey ?? t.id)));
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
