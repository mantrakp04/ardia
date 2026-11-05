import { isFields, isString, isStringList, type Fields } from "../../lib/decode";
import type { SavedObject } from "../../lib/savedDocument";
import { newId } from "../browser/model";
import { MAX_CLOSED_TABS } from "./closedTabs";

const SNAPSHOT_FIELDS = ["url", "title", "favicon", "pin", "muted", "zoom", "customTitle", "customIcon", "pinnedUrl", "engine", "profileId"] as const;

const list = (v: unknown): Fields[] => (Array.isArray(v) ? v.filter(isFields) : []);
const pinAs = (t: Fields) => (isFields(t.pin) ? t.pin.as : undefined);
const keyOfTab = (t: Fields) => (isString(t.pinKey) ? t.pinKey : (t.id as string));
const isOriginal = (t: Fields) => !isString(t.pinKey) || t.pinKey === t.id;

const slotIds = (split: Fields): string[] =>
  list(split.slots).flatMap((slot) => (isStringList(slot.stack) ? slot.stack : isString(slot.tabId) ? [slot.tabId] : []));

const withoutOwnTopApps = (profiles: unknown): unknown =>
  isFields(profiles) && Object.values(profiles).some((p) => isFields(p) && "ownTopApps" in p)
    ? Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, isFields(p) ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== "ownTopApps")) : p]))
    : profiles;

type Holding = { live: Fields[]; parked: boolean };

function ownersOf(key: string, holders: Map<string, Holding>, choices: Fields): string[] {
  const stamped = [...holders.keys()].filter((p) => isFields(choices[p]) && isString((choices[p] as Fields)[key]));
  if (stamped.length) return stamped;
  if ([...holders.values()].some((h) => h.parked)) return [];
  const originals = [...holders].filter(([, h]) => h.live.some((t) => t.id === key && isOriginal(t))).map(([p]) => p);
  return originals.length === 1 ? originals : [];
}

export function sessionWithOwnTopApps(doc: SavedObject): SavedObject {
  const profiles = withoutOwnTopApps(doc.profiles);
  const known = isFields(profiles) ? profiles : {};
  const keepsOwn = (id: string) => isFields(known[id]) && known[id].shareTopApps !== true;
  const circles = (isString(doc.topAppsMerged) ? doc.topAppsMerged.split("|") : []).map((k) => k.split(",").filter(keepsOwn)).filter((c) => c.length > 1);
  if (!circles.length) return profiles === doc.profiles ? doc : { ...doc, profiles };

  const tabs = list(doc.tabs).filter((t) => isString(t.id));
  const inPinnedGroup = new Set(list(doc.groups).filter((g) => g.pinned === true && isStringList(g.tabIds)).flatMap((g) => g.tabIds as string[]));
  const inSplit = new Set(list(doc.splits).flatMap(slotIds));
  const isLiveTile = (t: Fields) => pinAs(t) === "tile" && !inPinnedGroup.has(t.id as string);
  const parkedPins: Fields = isFields(doc.parkedPins) ? { ...doc.parkedPins } : {};
  const parkedTilesOf = (p: string) => list(isFields(parkedPins[p]) ? (parkedPins[p] as Fields).tabs : []).filter((e) => isString(e.id) && !e.groupId && pinAs(e) !== "row");
  const choices = isFields(doc.pinChoices) ? doc.pinChoices : {};
  const inParkedSplit = (p: string) => new Set(list(isFields(parkedPins[p]) ? (parkedPins[p] as Fields).splits : []).flatMap(slotIds));

  const dropTabs = new Set<string>();
  const dropParked = new Map<string, Set<string>>();
  let budget = MAX_CLOSED_TABS;
  for (const circle of circles) {
    const byKey = new Map<string, Map<string, Holding>>();
    const hold = (key: string, p: string) => {
      const holders = byKey.get(key) ?? byKey.set(key, new Map()).get(key)!;
      return holders.get(p) ?? holders.set(p, { live: [], parked: false }).get(p)!;
    };
    for (const t of tabs) if (circle.includes(t.profileId as string) && isLiveTile(t)) hold(keyOfTab(t), t.profileId as string).live.push(t);
    for (const p of circle) for (const e of parkedTilesOf(p)) hold(e.id as string, p).parked = true;
    for (const [key, holders] of byKey) {
      if (holders.size < 2) continue;
      const owners = ownersOf(key, holders, choices);
      if (!owners.length) continue;
      for (const [p, h] of holders) {
        if (owners.includes(p)) continue;
        if (h.live.some((t) => inSplit.has(t.id as string))) continue;
        if (h.parked && inParkedSplit(p).has(key)) continue;
        const parkedCount = h.parked ? parkedTilesOf(p).filter((e) => e.id === key).length : 0;
        if (h.live.length + parkedCount > budget) continue;
        budget -= h.live.length + parkedCount;
        for (const t of h.live) dropTabs.add(t.id as string);
        if (h.parked) (dropParked.get(p) ?? dropParked.set(p, new Set()).get(p)!).add(key);
      }
    }
  }

  const profileOfAny = new Map(tabs.map((t) => [t.id as string, t.profileId]));
  const keepAll = (ids: string[]) => ids.length && ids.every((id) => dropTabs.has(id)) && ids.forEach((id) => dropTabs.delete(id));
  for (const w of list(doc.windows)) {
    if (!isStringList(w.tabIds)) continue;
    keepAll(w.tabIds);
    for (const p of new Set(w.tabIds.map((id) => profileOfAny.get(id)))) keepAll(w.tabIds.filter((id) => profileOfAny.get(id) === p));
  }

  const closedAt = Date.now();
  const closed: Fields[] = [];
  const closedEntry = (t: Fields, windowId: string, index: number): Fields => ({
    kind: "tab",
    id: newId("ct"),
    tab: Object.fromEntries(SNAPSHOT_FIELDS.filter((k) => k in t).map((k) => [k, t[k]])),
    windowId,
    index,
    group: null,
    closedAt,
  });
  for (const [p, keys] of dropParked) {
    const park = parkedPins[p] as Fields;
    const dropped = (e: Fields) => keys.has(e.id as string) && !e.groupId && pinAs(e) !== "row";
    for (const e of list(park.tabs)) if (dropped(e)) closed.push(closedEntry({ ...e, profileId: p }, "", 0));
    parkedPins[p] = { ...park, tabs: list(park.tabs).filter((e) => !dropped(e)) };
  }
  const kept = list(doc.tabs).filter((t) => !dropTabs.has(t.id as string));
  const tabById = new Map(list(doc.tabs).map((t) => [t.id as string, t]));
  const profileOfTab = new Map(kept.map((t) => [t.id as string, t.profileId]));
  const windows = list(doc.windows).map((w) => {
    if (!isStringList(w.tabIds) || !w.tabIds.some((id) => dropTabs.has(id))) return w;
    w.tabIds.forEach((id, index) => dropTabs.has(id) && tabById.has(id) && closed.push(closedEntry(tabById.get(id)!, w.id as string, index)));
    const tabIds = w.tabIds.filter((id) => !dropTabs.has(id));
    const active = isFields(w.activeTabIds) ? w.activeTabIds : {};
    const activeTabIds = Object.fromEntries(
      Object.entries(active)
        .map(([p, id]) => [p, isString(id) && dropTabs.has(id) ? tabIds.find((t) => profileOfTab.get(t) === p) : id] as const)
        .filter(([, id]) => isString(id)),
    );
    return { ...w, tabIds, activeTabIds };
  });
  const closedTabs = [...list(doc.closedTabs), ...closed].slice(-MAX_CLOSED_TABS);
  return { ...doc, profiles, tabs: kept, windows, parkedPins, closedTabs };
}
