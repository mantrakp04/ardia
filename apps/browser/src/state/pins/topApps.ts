import type { BrowserState } from "../browser/store";
import { pinSection } from "../browser/model";
import type { Tab } from "../browser/types";
import { dataGroups, dataIdOf } from "../profiles/profiles";
import { isRegularWindow } from "../windows/small";
import { conform, pinnedGroupsOf, pinsMayDiffer, profilesOf, sectionOf, tileSig, union, type Section } from "./pinMirror";

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

export function mirrorTopApps(s: BrowserState, prev: BrowserState): BrowserState | null {
  const circles = topAppCircles(s);
  if (!circles.length) return null;
  const turnedOn = sharingChanged(s, prev);
  if (!turnedOn && !pinsMayDiffer(s, prev)) return null;
  const order = [...new Set([...s.ui.focusOrder, ...s.windowOrder])].filter((id) => isRegularWindow(s.windows[id]));
  const prevGroups = pinnedGroupsOf(prev);
  let next = s;
  for (const circle of circles) {
    const places = circle.flatMap((p) => order.filter((w) => profilesOf(next, next.windows[w]!).has(p)).map((w) => [w, p] as const));
    if (places.length < 2) continue;
    const nowGroups = pinnedGroupsOf(next);
    const sections = places.map(([w, p]) => sectionOf(next, next.windows[w]!, p, nowGroups));
    const sigs = sections.map(topAppSig);
    if (new Set(sigs).size === 1) continue;
    const was = (w: string, p: string) => {
      const before = prev.windows[w];
      return isRegularWindow(before) && profilesOf(prev, before).has(p) ? topAppSig(sectionOf(prev, before, p, prevGroups)) : null;
    };
    const source = turnedOn
      ? -1
      : places.findIndex(([w, p], i) => {
          const before = was(w, p);
          return before !== null && before !== sigs[i];
        });
    const old = places.map(([w, p], i) => (was(w, p) === null ? null : i)).filter((i): i is number => i !== null);
    const ranked = source >= 0 ? [source] : old.length ? old : places.map((_, i) => i);
    const tiles = topAppItems(source >= 0 ? sections[source]! : union(ranked.map((i) => ({ ...sections[i]!, items: topAppItems(sections[i]!) }))));
    const want = tiles.map((i) => tileSig(i.tab)).join("\n");
    places.forEach(([w, p], i) => {
      if (i === source || sigs[i] === want || !next.windows[w]) return;
      const own = sectionOf(next, next.windows[w]!, p, pinnedGroupsOf(next));
      next = conform(next, w, p, { ...own, items: [...own.items.filter((x) => x.group || !isTopApp(x.tab)), ...tiles] });
    });
  }
  return next === s ? null : next;
}
