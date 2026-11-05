import type { BrowserState } from "../browser/store";
import { isPinnedRow, makeTab, pinKeyOf, pinSection, snapshotTab, TILE_PIN } from "../browser/model";
import type { ParkedPins, Profile, Tab } from "../browser/types";
import { isFields } from "../../lib/decode";
import { dataGroups, dataIdOf, sharingProfiles } from "../profiles/profiles";
import { isRegularWindow } from "../windows/small";
import { writingFromSync } from "./syncWrites";
import { conform, pinnedGroupsOf, pinsMayDiffer, profilesOf, sectionOf, tileSig, union, type Item, type Section } from "./pinMirror";

type Sharing = Pick<BrowserState, "profiles">;
type Circles = Pick<BrowserState, "profiles" | "profileOrder">;

export const isTopApp = (t: Pick<Tab, "pin">) => pinSection(t) === "tile";

const sharingDataOf = (s: Sharing, profileId: string) => {
  const p = s.profiles[profileId];
  return p && !p.ownTopApps ? dataIdOf(p) : undefined;
};

export function topAppsShared(s: Sharing, a: string, b: string): boolean {
  if (a === b) return false;
  const data = sharingDataOf(s, a);
  return !!data && data === sharingDataOf(s, b);
}

export const profilesAfterSharingSetting = (profiles: Record<string, Profile>, settings: unknown): Record<string, Profile> =>
  isFields(settings) && settings.shareTopApps === false ? Object.fromEntries(Object.entries(profiles).map(([id, p]) => [id, { ...p, ownTopApps: true }])) : profiles;

export const sameTopApp = (s: Sharing, a: Pick<Tab, "pin" | "profileId">, b: Pick<Tab, "pin" | "profileId">) =>
  isTopApp(a) && isTopApp(b) && topAppsShared(s, a.profileId, b.profileId);

export function topAppCircles(s: Circles): string[][] {
  return dataGroups(s)
    .map((g) => g.profileIds.filter((id) => !s.profiles[id]!.ownTopApps))
    .filter((ids) => ids.length > 1);
}

export const topAppSiblings = (s: Circles, profileId: string): string[] =>
  s.profiles[profileId]?.ownTopApps ? [] : sharingProfiles(s, profileId).filter((id) => !s.profiles[id]!.ownTopApps);

const circleKey = (ids: string[]) => [...ids].sort().join(",");

let lastCircles: { profiles: unknown; profileOrder: unknown; key: string } | null = null;

function circlesKey(s: Circles): string {
  if (lastCircles && lastCircles.profiles === s.profiles && lastCircles.profileOrder === s.profileOrder) return lastCircles.key;
  const key = topAppCircles(s)
    .map(circleKey)
    .sort()
    .join("|");
  lastCircles = { profiles: s.profiles, profileOrder: s.profileOrder, key };
  return key;
}

export function sharingChanged(s: Circles, prev: Circles): boolean {
  if (s.profiles === prev.profiles && s.profileOrder === prev.profileOrder) return false;
  return circlesKey(s) !== circlesKey(prev);
}

const topAppItems = (x: Section) => x.items.filter((i) => !i.group && isTopApp(i.tab));
const topAppSig = (x: Section) => topAppItems(x).map((i) => tileSig(i.tab)).join("\n");

type ParkedPin = ParkedPins["tabs"][number];
const isParkedTile = (p: ParkedPin) => !p.groupId && !isPinnedRow(p);

function parkedSection(s: Pick<BrowserState, "parkedPins">, profileId: string): Section {
  const tiles = (s.parkedPins[profileId]?.tabs ?? []).filter(isParkedTile);
  const items = tiles.map(({ id, groupId: _, restoreFrom: __, ...snap }) => ({
    tab: { ...makeTab("", profileId, snap.url, { ...snap, profileId, pin: snap.pin ?? TILE_PIN, pinnedUrl: snap.pinnedUrl || snap.url }), id },
    group: null,
  }));
  return { items, groups: new Map(), own: [] };
}

function withParkedTiles(s: BrowserState, profileId: string, tiles: Item[]): BrowserState {
  const park = s.parkedPins[profileId] ?? { tabs: [], groups: [] };
  const old = new Map(park.tabs.filter(isParkedTile).map((p) => [p.id, p]));
  const entries: ParkedPin[] = tiles.map(({ tab }) => {
    const id = pinKeyOf(tab);
    const was = old.get(id);
    const kept = { pin: tab.pin, customTitle: tab.customTitle, customIcon: tab.customIcon, pinnedUrl: tab.pinnedUrl };
    const home = tab.pinnedUrl || tab.url;
    return was && (was.pinnedUrl || was.url) === home ? { ...was, ...kept } : { ...snapshotTab(tab), url: home, profileId, id, groupId: null };
  });
  const ids = new Set(entries.map((p) => p.id));
  const rest = park.tabs.filter((p) => !isParkedTile(p) && !ids.has(p.id));
  return { ...s, parkedPins: { ...s.parkedPins, [profileId]: { ...park, tabs: [...entries, ...rest] } } };
}

type Member = { window: string | null; profileId: string };

const keyOf = (i: Item) => pinKeyOf(i.tab);

const EDITABLE = ["pinnedUrl", "customTitle", "customIcon", "pin"] as const;
const sameField = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function withChange(target: Item[], before: Item[], after: Item[], blocked: Set<string>): Item[] {
  const beforeOf = new Map(before.map((i) => [keyOf(i), i]));
  const afterKeys = new Set(after.map(keyOf));
  const held = new Set(target.map(keyOf));
  const reentering = new Set(after.map(keyOf).filter((k) => !beforeOf.has(k) && held.has(k) && !blocked.has(k)));
  const out = target
    .filter((i) => afterKeys.has(keyOf(i)) || !beforeOf.has(keyOf(i)))
    .map((i) => {
      const now = after.find((a) => keyOf(a) === keyOf(i));
      if (!now || blocked.has(keyOf(i))) return i;
      if (reentering.has(keyOf(i))) return { ...i, tab: { ...i.tab, pin: now.tab.pin } };
      const was = beforeOf.get(keyOf(i));
      if (!was) return i;
      const edited = EDITABLE.filter((f) => !sameField(was.tab[f], now.tab[f]));
      return edited.length ? { ...i, tab: { ...i.tab, ...Object.fromEntries(edited.map((f) => [f, now.tab[f]])) } } : i;
    });
  const shared = (keys: string[]) => keys.filter((k) => (beforeOf.has(k) && afterKeys.has(k)) || reentering.has(k));
  const sourceOrder = shared(after.map(keyOf));
  if (reentering.size || shared(before.map(keyOf)).join("\n") !== sourceOrder.join("\n")) {
    const inOut = new Set(out.map(keyOf));
    const order = sourceOrder.filter((k) => inOut.has(k));
    const slots = out.map((i, n) => (order.includes(keyOf(i)) ? n : -1)).filter((n) => n >= 0);
    const byKey = new Map(out.map((i) => [keyOf(i), i]));
    slots.forEach((slot, n) => (out[slot] = byKey.get(order[n]!)!));
  }
  after.forEach((item, n) => {
    const key = keyOf(item);
    if (beforeOf.has(key) || blocked.has(key) || out.some((i) => keyOf(i) === key)) return;
    let anchor = -1;
    for (let m = n - 1; m >= 0 && anchor < 0; m--) anchor = out.findIndex((i) => keyOf(i) === keyOf(after[m]!));
    out.splice(anchor + 1, 0, item);
  });
  return out;
}

const shownAnywhere = (s: BrowserState, p: string) => Object.values(s.windows).some((w) => isRegularWindow(w) && profilesOf(s, w).has(p));

function keepEmptiedParks(s: BrowserState, prev: BrowserState, circles: string[][]): BrowserState | null {
  if (s.parkedPins === prev.parkedPins) return null;
  const emptied = circles.flat().filter((p) => prev.parkedPins[p] && !s.parkedPins[p] && !shownAnywhere(s, p));
  if (!emptied.length) return null;
  return { ...s, parkedPins: { ...s.parkedPins, ...Object.fromEntries(emptied.map((p) => [p, { tabs: [], groups: [] }])) } };
}

export function mirrorTopApps(s: BrowserState, prev: BrowserState): BrowserState | null {
  const key = circlesKey(s);
  const recorded = key !== s.topAppsMerged ? { ...s, topAppsMerged: key } : s;
  const onlyRecorded = recorded === s ? null : recorded;
  if (!key) return onlyRecorded;
  const circles = topAppCircles(s);
  const merged = s.topAppsMerged.split("|").map((k) => new Set(k.split(",")));
  const joining = new Set(circles.filter((c) => !merged.some((m) => c.every((id) => m.has(id)))).map(circleKey));
  const kept = writingFromSync() ? keepEmptiedParks(recorded, prev, circles) : null;
  if (!joining.size && (kept || writingFromSync())) return kept ?? onlyRecorded;
  if (!joining.size && !pinsMayDiffer(s, prev) && s.parkedPins === prev.parkedPins) return onlyRecorded;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isRegularWindow(s.windows[id]));
  const prevGroups = pinnedGroupsOf(prev);
  const hadPlace = (p: string) => shownAnywhere(prev, p);
  let next: BrowserState = kept ?? recorded;
  for (const circle of circles) {
    const turnedOn = joining.has(circleKey(circle));
    if (!turnedOn && writingFromSync()) continue;
    const members = circle.flatMap((p): Member[] => {
      const windows = order.filter((w) => profilesOf(next, next.windows[w]!).has(p));
      return windows.length ? windows.map((w) => ({ window: w, profileId: p })) : [{ window: null, profileId: p }];
    });
    if (members.length < 2) continue;
    const nowGroups = pinnedGroupsOf(next);
    const sectionNow = (m: Member) => (m.window ? sectionOf(next, next.windows[m.window]!, m.profileId, nowGroups) : parkedSection(next, m.profileId));
    const sections = members.map(sectionNow);
    const sigs = sections.map(topAppSig);
    if (new Set(sigs).size === 1) continue;
    const sectionBefore = ({ window: w, profileId: p }: Member): Section => {
      const before = w ? prev.windows[w] : undefined;
      return isRegularWindow(before) && profilesOf(prev, before).has(p) ? sectionOf(prev, before, p, prevGroups) : parkedSection(prev, p);
    };
    const wasParked = (p: string) => (!hadPlace(p) && prev.parkedPins[p] ? topAppSig(parkedSection(prev, p)) : null);
    const was = ({ window: w, profileId: p }: Member) => {
      if (!w) return hadPlace(p) || !prev.parkedPins[p] ? null : topAppSig(parkedSection(prev, p));
      const before = prev.windows[w];
      return isRegularWindow(before) && profilesOf(prev, before).has(p) ? topAppSig(sectionOf(prev, before, p, prevGroups)) : wasParked(p);
    };
    const source = turnedOn
      ? -1
      : members.findIndex((m, i) => {
          const before = was(m);
          return before !== null && before !== sigs[i];
        });
    const old = members.map((m, i) => (was(m) === null ? null : i)).filter((i): i is number => i !== null);
    const receives = (i: number) => source >= 0 || turnedOn || (old.length > 0 && !old.includes(i));
    const merged = source >= 0 ? [] : topAppItems(union((old.length ? old : members.map((_, i) => i)).map((i) => ({ ...sections[i]!, items: topAppItems(sections[i]!) }))));
    const before = source >= 0 ? topAppItems(sectionBefore(members[source]!)) : [];
    const after = source >= 0 ? topAppItems(sections[source]!) : [];
    members.forEach(({ window: w, profileId: p }, i) => {
      if (i === source || !receives(i)) return;
      const blocked = new Set(sections[i]!.items.filter((x) => x.group || !isTopApp(x.tab)).map((x) => pinKeyOf(x.tab)));
      if (!w) for (const e of next.parkedPins[p]?.tabs ?? []) if (!isParkedTile(e)) blocked.add(e.id);
      const own = topAppItems(sections[i]!);
      const tiles = source >= 0 ? withChange(own, before, after, blocked) : merged.filter((x) => !blocked.has(pinKeyOf(x.tab)));
      if (tiles.map((x) => tileSig(x.tab)).join("\n") === sigs[i]) return;
      if (!w) {
        next = withParkedTiles(next, p, tiles);
        return;
      }
      if (!next.windows[w]) return;
      const section = sectionOf(next, next.windows[w]!, p, pinnedGroupsOf(next));
      next = conform(next, w, p, { ...section, items: [...section.items.filter((x) => x.group || !isTopApp(x.tab)), ...tiles] });
    });
  }
  return next === s ? null : next;
}
