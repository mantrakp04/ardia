import { orderSections as pinnedFirst } from "../groups/groups";
import type { BrowserState } from "../browser/store";
import type { Tab, TopApp } from "../browser/types";
import { makeTab, without } from "../browser/model";
import { isRegularWindow as mirrored } from "../windows/small";
import { ASLEEP, hasPage, holderOfPage, isAsleep, wakeOf, wokenPage, withNavigationAt } from "../tabs/pageSession";
import { pinKeyOf } from "../browser/model";

const tile = (tab: Tab | undefined): tab is Tab => !!tab && tab.pin?.as === "tile";
const profileOf = (s: BrowserState, tab: Tab) => s.spaces[tab.spaceId]?.profileId;
const specOf = (tab: Tab): TopApp => ({
  key: pinKeyOf(tab), url: tab.pinnedUrl || tab.url, title: tab.title, favicon: tab.favicon,
  customTitle: tab.customTitle, customIcon: tab.customIcon, ...((tab.pin?.as === "tile" ? tab.pin.folder : undefined) ? { tileFolder: (tab.pin?.as === "tile" ? tab.pin.folder : undefined) } : {}),
});
const signature = (items: TopApp[]) => JSON.stringify(items.map(({ title: _t, favicon: _f, ...item }) => item));

export function mirrorTopApps(s: BrowserState, prev: BrowserState): BrowserState | null {
  if (s.tabs === prev.tabs && s.windows === prev.windows && s.spaces === prev.spaces && s.topApps === prev.topApps && s.parkedPins === prev.parkedPins) return null;
  let topApps = s.topApps;
  const edit = (profileId: string, items: TopApp[]) => {
    if (signature(topApps[profileId] ?? []) === signature(items) && topApps[profileId]) return;
    topApps = { ...topApps, [profileId]: items };
  };
  if (s.topApps === prev.topApps || !Object.keys(s.topApps).length) {
    for (const profile of Object.values(s.profiles)) {
      const sourceWindow = s.ui.focusOrder.find((id) => {
        const w = s.windows[id], was = prev.windows[id];
        return w && was && mirrored(w) && s.spaces[w.spaceId]?.profileId === profile.id && (w.tabIds !== was.tabIds || w.tabIds.some((key) => { const tab = s.tabs[key], before = prev.tabs[key]; return tile(tab) && before !== tab && (!tile(before) || signature([specOf(tab)]) !== signature([specOf(before)])); }));
      });
      let items = topApps[profile.id];
      if (!items) {
        const seen = new Set<string>();
        items = Object.values(s.tabs).filter((tab) => tile(tab) && profileOf(s, tab) === profile.id).flatMap((tab) => {
          const key = pinKeyOf(tab);
          if (seen.has(key)) return [];
          seen.add(key);
          return [specOf(tab)];
        });
        edit(profile.id, items);
      }
      for (const [spaceId, park] of Object.entries(prev.parkedPins)) {
        if (park === s.parkedPins[spaceId] || s.spaces[spaceId]?.profileId !== profile.id || prev.spaces[spaceId]?.profileId !== profile.id) continue;
        const next = s.parkedPins[spaceId]?.tabs ?? [];
        const gone = park.tabs.filter((tab) => !tab.groupId && tab.pin?.as !== "row" && !next.some((other) => other.id === tab.id) && !Object.values(s.tabs).some((other) => tile(other) && profileOf(s, other) === profile.id && pinKeyOf(other) === tab.id));
        if (gone.length) { items = items.filter((item) => !gone.some((tab) => tab.id === item.key)); edit(profile.id, items); }
        for (const tab of next) {
          const before = park.tabs.find((other) => other.id === tab.id);
          if (tab.groupId || tab.pin?.as === "row" || !before || JSON.stringify((before.pin?.as === "tile" ? before.pin.folder : undefined)) === JSON.stringify((tab.pin?.as === "tile" ? tab.pin.folder : undefined))) continue;
          items = items.map((item) => item.key === tab.id ? { ...item, tileFolder: (tab.pin?.as === "tile" ? tab.pin.folder : undefined) } : item);
          edit(profile.id, items);
        }
      }
      const removed = new Set(Object.values(prev.tabs).filter((tab) => tile(tab) && profileOf(prev, tab) === profile.id && s.spaces[tab.spaceId]?.profileId === profile.id && s.windows[tab.windowId] && (s.tabs[tab.id] ? !tile(s.tabs[tab.id]) || profileOf(s, s.tabs[tab.id]!) !== profile.id : !Object.values(s.tabs).some((other) => tile(other) && profileOf(s, other) === profile.id && pinKeyOf(other) === pinKeyOf(tab)))).map(pinKeyOf));
      if (removed.size) { items = items.filter((item) => !removed.has(item.key)); edit(profile.id, items); }
      for (const tab of Object.values(s.tabs)) {
        if (!tile(tab) || profileOf(s, tab) !== profile.id || sourceWindow && tab.windowId !== sourceWindow || !mirrored(s.windows[tab.windowId])) continue;
        const before = prev.tabs[tab.id];
        if (before === tab || (prev.spaces[tab.spaceId] && prev.spaces[tab.spaceId]!.profileId !== profile.id)) continue;
        const spec = specOf(tab);
        if (before && tile(before) && signature([specOf(before)]) === signature([spec])) continue;
        const at = items.findIndex((item) => item.key === spec.key);
        if (at < 0) { items = [...items, spec]; edit(profile.id, items); }
        else if (signature([items[at]!]) !== signature([spec])) { items = items.map((item, i) => i === at ? spec : item); edit(profile.id, items); }
      }
      const changedWindow = s.ui.focusOrder.map((id) => s.windows[id]).find((w) => w && mirrored(w) && prev.windows[w.id] && w.tabIds !== prev.windows[w.id]!.tabIds && s.spaces[w.spaceId]?.profileId === profile.id && prev.windows[w.id]!.spaceId === w.spaceId);
      if (changedWindow) {
        const order = changedWindow.tabIds.map((id) => s.tabs[id]).filter((tab) => tile(tab) && tab.spaceId === changedWindow.spaceId).map((tab) => pinKeyOf(tab!));
        if (order.length === items.length && items.every((item) => order.includes(item.key))) edit(profile.id, order.map((key) => items!.find((item) => item.key === key)!));
      }
    }
  }
  let tabs = s.tabs;
  let windows = s.windows;
  let parkedTopApps = s.parkedTopApps;
  for (const w of Object.values(s.windows)) {
    if (!mirrored(w)) continue;
    const spaceIds = new Set([w.spaceId, ...w.tabIds.flatMap((id) => s.tabs[id]?.spaceId ? [s.tabs[id]!.spaceId] : [])]);
    let ids = w.tabIds;
    let activeTabIds = w.activeTabIds;
    for (const spaceId of spaceIds) {
      const profileId = s.spaces[spaceId]?.profileId;
      if (!profileId) continue;
      const specs = topApps[profileId] ?? [];
      const own = ids.flatMap((id) => tile(tabs[id]) && tabs[id]!.spaceId === spaceId ? [tabs[id]!] : []);
      const keys = new Set(specs.map((item) => item.key));
      for (const tab of own) {
        if (keys.has(pinKeyOf(tab))) continue;
        if (tabs === s.tabs) tabs = { ...tabs };
        if (hasPage(tab) || wakeOf(tab)) tabs[tab.id] = { ...tab, pin: null, pinnedUrl: null, pinKey: undefined };
        else { delete tabs[tab.id]; ids = ids.filter((id) => id !== tab.id); }
      }
      const tiles: string[] = [];
      for (const spec of specs) {
        let tab = own.filter((candidate) => pinKeyOf(candidate) === spec.key && tabs[candidate.id]).sort((a, b) => Number(hasPage(b)) - Number(hasPage(a)) || b.lastActiveAt - a.lastActiveAt)[0];
        const parked = parkedTopApps[profileId]?.find((candidate) => pinKeyOf(candidate) === spec.key);
        if (parked) {
          if (tabs === s.tabs) tabs = { ...tabs };
          if (tab && tab.id !== parked.id) {
            const replaced = tab.id;
            delete tabs[replaced];
            ids = ids.map((id) => id === replaced ? parked.id : id);
            activeTabIds = Object.fromEntries(Object.entries(activeTabIds).map(([id, value]) => [id, value === replaced ? parked.id : value]));
          }
          tab = { ...parked, windowId: w.id, spaceId, page: hasPage(parked) ? withNavigationAt(parked) : wokenPage(parked) };
          tabs[tab.id] = tab;
          parkedTopApps = { ...parkedTopApps, [profileId]: parkedTopApps[profileId]!.filter((candidate) => candidate.id !== parked.id) };
        }
        if (!tab) {
          tab = { ...makeTab(w.id, spaceId, spec.url), pin: spec.tileFolder ? { as: "tile", folder: spec.tileFolder } : { as: "tile" }, pinnedUrl: spec.url, pinKey: spec.key, page: ASLEEP, title: spec.title, favicon: spec.favicon, customTitle: spec.customTitle, customIcon: spec.customIcon };
          if (tabs === s.tabs) tabs = { ...tabs };
          tabs[tab.id] = tab;
        } else if (signature([specOf(tab)]) !== signature([spec])) {
          if (tabs === s.tabs) tabs = { ...tabs };
          tabs[tab.id] = { ...tab, ...(isAsleep(tab) ? { url: spec.url } : {}), pinnedUrl: spec.url, customTitle: spec.customTitle, customIcon: spec.customIcon, pin: spec.tileFolder ? { as: "tile", folder: spec.tileFolder } : { as: "tile" } };
        }
        tiles.push(tab.id);
      }
      for (const duplicate of own) {
        if (tiles.includes(duplicate.id) || !tabs[duplicate.id] || !keys.has(pinKeyOf(duplicate))) continue;
        if (tabs === s.tabs) tabs = { ...tabs };
        if (hasPage(duplicate) || wakeOf(duplicate)) tabs[duplicate.id] = { ...duplicate, pin: null, pinnedUrl: null, pinKey: undefined };
        else {
          const target = tiles.find((id) => pinKeyOf(tabs[id]!) === pinKeyOf(duplicate));
          delete tabs[duplicate.id];
          ids = ids.filter((id) => id !== duplicate.id);
          if (target) activeTabIds = Object.fromEntries(Object.entries(activeTabIds).map(([id, value]) => [id, value === duplicate.id ? target : value]));
        }
      }
      const oldTiles = new Set(own.filter((tab) => tile(tabs[tab.id])).map((tab) => tab.id));
      const first = ids.findIndex((id) => oldTiles.has(id) || s.tabs[id]?.spaceId === spaceId);
      const rest = ids.filter((id) => !oldTiles.has(id));
      const at = first < 0 ? rest.length : Math.min(first, rest.length);
      const next = [...rest.slice(0, at), ...tiles, ...rest.slice(at)];
      if (next.length !== ids.length || next.some((id, i) => id !== ids[i])) ids = next;
    }
    const sorted = ids.some((id) => tile(tabs[id])) || w.tabIds.some((id) => tile(prev.tabs[id])) ? pinnedFirst(ids, tabs, s.groups) : ids;
    if (sorted.some((id, i) => id !== ids[i])) ids = sorted;
    if (ids !== w.tabIds || activeTabIds !== w.activeTabIds) { if (windows === s.windows) windows = { ...windows }; windows[w.id] = { ...w, tabIds: ids, activeTabIds }; }
  }
  return topApps === s.topApps && tabs === s.tabs && windows === s.windows && parkedTopApps === s.parkedTopApps ? null : { ...s, topApps, tabs, windows, parkedTopApps };
}

export function parkSpaceTopApps(s: BrowserState, spaceId: string): BrowserState {
  const profileId = s.spaces[spaceId]?.profileId;
  if (!profileId) return s;
  const owners = Object.values(s.tabs).filter((tab) => tab.spaceId === spaceId && tile(tab) && !holderOfPage(tab) && (hasPage(tab) || wakeOf(tab)));
  if (!owners.length) return s;
  const removed = new Set(owners.map((tab) => tab.id));
  const parked = [...(s.parkedTopApps[profileId] ?? []).filter((tab) => !owners.some((owner) => pinKeyOf(owner) === pinKeyOf(tab))), ...owners];
  return {
    ...s, parkedTopApps: { ...s.parkedTopApps, [profileId]: parked },
    tabs: without(s.tabs, [...removed]),
    windows: Object.fromEntries(Object.entries(s.windows).map(([id, w]) => [id, w.tabIds.some((key) => removed.has(key)) ? { ...w, tabIds: w.tabIds.filter((key) => !removed.has(key)), activeTabIds: Object.fromEntries(Object.entries(w.activeTabIds).filter(([, key]) => !removed.has(key))) } : w])),
  };
}

export function parkedTopAppOwners(s: Pick<BrowserState, "parkedTopApps">): Map<string, { profileId: string; tab: Tab }> {
  return new Map(Object.entries(s.parkedTopApps).flatMap(([profileId, tabs]) => tabs.map((tab) => [tab.id, { profileId, tab }] as const)));
}
