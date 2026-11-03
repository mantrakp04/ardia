import type { BrowserState } from "../browser/store";
import { isPinnedRow, makeTab, pinKeyOf, pinSection, snapshotTab, TILE_PIN } from "../browser/model";
import type { ParkedPins, Tab } from "../browser/types";
import { dataGroups, dataIdOf } from "../profiles/profiles";
import { isRegularWindow } from "../windows/small";
import { conform, pinnedGroupsOf, pinsMayDiffer, profilesOf, sectionOf, tileSig, union, type Item, type Section } from "./pinMirror";

type Sharing = Pick<BrowserState, "profiles" | "settings">;

export const isTopApp = (t: Pick<Tab, "pin">) => pinSection(t) === "tile";

const dataOf = (s: Pick<BrowserState, "profiles">, profileId: string) => {
  const p = s.profiles[profileId];
  return p ? dataIdOf(p) : undefined;
};

export function topAppsShared(s: Sharing, a: string, b: string): boolean {
  if (a === b || !s.settings.shareTopApps) return false;
  const data = dataOf(s, a);
  return !!data && data === dataOf(s, b);
}

export const sameTopApp = (s: Sharing, a: Pick<Tab, "pin" | "profileId">, b: Pick<Tab, "pin" | "profileId">) =>
  isTopApp(a) && isTopApp(b) && topAppsShared(s, a.profileId, b.profileId);

export function topAppCircles(s: Pick<BrowserState, "profiles" | "profileOrder" | "settings">): string[][] {
  if (!s.settings.shareTopApps) return [];
  return dataGroups(s).map((g) => g.profileIds).filter((ids) => ids.length > 1);
}

export const sharingChanged = (s: Sharing, prev: Sharing) => s.profiles !== prev.profiles || s.settings.shareTopApps !== prev.settings.shareTopApps;

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
    return was ? { ...was, ...kept } : { ...snapshotTab(tab), url: tab.pinnedUrl || tab.url, profileId, id, groupId: null };
  });
  const ids = new Set(entries.map((p) => p.id));
  const rest = park.tabs.filter((p) => !isParkedTile(p) && !ids.has(p.id));
  return { ...s, parkedPins: { ...s.parkedPins, [profileId]: { ...park, tabs: [...entries, ...rest] } } };
}

type Member = { window: string | null; profileId: string };

export function mirrorTopApps(s: BrowserState, prev: BrowserState): BrowserState | null {
  const circles = topAppCircles(s);
  if (!circles.length) return null;
  const turnedOn = sharingChanged(s, prev);
  if (!turnedOn && !pinsMayDiffer(s, prev) && s.parkedPins === prev.parkedPins) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isRegularWindow(s.windows[id]));
  const prevGroups = pinnedGroupsOf(prev);
  const hadPlace = (p: string) => Object.values(prev.windows).some((w) => isRegularWindow(w) && profilesOf(prev, w).has(p));
  let next = s;
  for (const circle of circles) {
    const members = circle.flatMap((p): Member[] => {
      const windows = order.filter((w) => profilesOf(next, next.windows[w]!).has(p));
      if (windows.length) return windows.map((w) => ({ window: w, profileId: p }));
      return next.parkedPins[p] || prev.parkedPins[p] ? [{ window: null, profileId: p }] : [];
    });
    if (members.length < 2) continue;
    const nowGroups = pinnedGroupsOf(next);
    const sectionNow = (m: Member) => (m.window ? sectionOf(next, next.windows[m.window]!, m.profileId, nowGroups) : parkedSection(next, m.profileId));
    const sections = members.map(sectionNow);
    const sigs = sections.map(topAppSig);
    if (new Set(sigs).size === 1) continue;
    const was = ({ window: w, profileId: p }: Member) => {
      if (!w) return hadPlace(p) ? null : topAppSig(parkedSection(prev, p));
      const before = prev.windows[w];
      return isRegularWindow(before) && profilesOf(prev, before).has(p) ? topAppSig(sectionOf(prev, before, p, prevGroups)) : null;
    };
    const source = turnedOn
      ? -1
      : members.findIndex((m, i) => {
          const before = was(m);
          return before !== null && before !== sigs[i];
        });
    const old = members.map((m, i) => (was(m) === null ? null : i)).filter((i): i is number => i !== null);
    const ranked = source >= 0 ? [source] : old.length ? old : members.map((_, i) => i);
    const tiles = topAppItems(source >= 0 ? sections[source]! : union(ranked.map((i) => ({ ...sections[i]!, items: topAppItems(sections[i]!) }))));
    const want = tiles.map((i) => tileSig(i.tab)).join("\n");
    members.forEach(({ window: w, profileId: p }, i) => {
      if (i === source || sigs[i] === want) return;
      if (!w) {
        next = withParkedTiles(next, p, tiles);
        return;
      }
      if (!next.windows[w]) return;
      const own = sectionOf(next, next.windows[w]!, p, pinnedGroupsOf(next));
      next = conform(next, w, p, { ...own, items: [...own.items.filter((x) => x.group || !isTopApp(x.tab)), ...tiles] });
    });
  }
  return next === s ? null : next;
}
