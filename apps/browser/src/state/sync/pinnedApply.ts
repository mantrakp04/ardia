import type { ApplyRecords } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { depthOf, leaveGroups, orderSections, syncGroupOrder, withParent } from "../groups/groups";
import { makeTab, newId, pinKeyOf, ROW_PIN, without } from "../browser/model";
import { noteRemotePinDeletion } from "../pins/tabCleanup";
import { type PinSyncEntry } from "../pins/pinChoices";
import { adoptParkedPins, parkWindowPins } from "../pins/parkedPins";
import { arrangePinnedArea } from "../pins/pinnedArea";
import { fromSync } from "../pins/pinOrderChoices";
import { removeTabs } from "../tabs/tabs";
import type { Tab, TabGroup } from "../browser/types";
import {
  anchorIn,
  markedTile,
  GROUP_LOOK,
  lookedColor,
  PIN_GROUP,
  PIN_NEST,
  PIN_ORDER,
  PIN_ROW,
  PIN_TAB,
  ROW,
  syncedHomeIn,
  type NestGroupValue,
  type NestTabValue,
  type PinGroupValue,
  type PinValue,
} from "./pinRecords";
import { homeWindow, store, type Window } from "./pinnedSyncState";
import { ASLEEP, hasPage, isAsleep } from "../tabs/pageSession";

export function applyPinned(profileId: string, visible: Map<string, unknown>, changed: Set<string>, base: (key: string) => unknown, records: ApplyRecords): boolean | void {
  if ([...changed].every((k) => k.startsWith(PIN_ROW))) return true;
  const pinItem = (k: string) => k.startsWith(PIN_TAB) || k.startsWith(PIN_GROUP) || k.startsWith(`${PIN_NEST}g:`);
  if ([...changed].some((k) => pinItem(k) && !visible.has(k))) noteRemotePinDeletion(profileId);
  const sync = store().pinSync[profileId] ?? {};
  let s = store();
  const home = homeWindow(s, profileId);
  if (!home) return false;
  const marked = (key: string) => (base(`${PIN_ROW}${key}`) === ROW ? (true as const) : undefined);
  const PARK = `park:${profileId}`;
  const shown = home.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  if (s.parkedPins[profileId] || !shown) {
    const stand: Window = { id: PARK, profileId, kind: "main", tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 };
    s = { ...s, windows: { ...s.windows, [PARK]: stand } };
    if (s.parkedPins[profileId]) s = adoptParkedPins(s, PARK, profileId);
  }
  const newPinWindow = shown ? home.id : PARK;
  const scope = new Set([home.id, PARK]);
  const tabOfKey = new Map<string, string>();
  const groupOfKey = new Map<string, string>();
  const pinnedMember = new Set(Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId).flatMap((g) => g.tabIds));
  const searchOrder = [...scope, ...Object.keys(s.windows).filter((w) => !scope.has(w))];
  const kept = new Map<string, Tab>();
  for (const wid of searchOrder) {
    for (const id of s.windows[wid]?.tabIds ?? []) {
      const t = s.tabs[id];
      if (t?.profileId !== profileId) continue;
      if (t.pin || pinnedMember.has(id)) {
        if (!tabOfKey.has(pinKeyOf(t))) tabOfKey.set(pinKeyOf(t), id);
      } else if (t.pinKey) {
        const other = kept.get(t.pinKey);
        if (!other || (!hasPage(other) && hasPage(t))) kept.set(t.pinKey, t);
      }
    }
  }
  for (const [key, t] of kept) if (!tabOfKey.has(key)) tabOfKey.set(key, t.id);
  for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId && scope.has(g.windowId) && !groupOfKey.has(pinKeyOf(g))) groupOfKey.set(pinKeyOf(g), g.id);
  const keyOfLocal = new Map<string, string>();
  const local = (ofKey: Map<string, string>, taken: (id: string) => boolean, key: string) => {
    const known = ofKey.get(key);
    if (known) return known;
    const id = taken(key) ? newId("tab") : key;
    ofKey.set(key, id);
    if (id !== key) keyOfLocal.set(id, key);
    return id;
  };
  const tid = (key: string) => local(tabOfKey, (id) => !!s.tabs[id] && s.tabs[id]!.profileId !== profileId, key);
  const gid = (key: string) => local(groupOfKey, (id) => !!s.groups[id] && (s.groups[id]!.profileId !== profileId || !s.groups[id]!.pinned), key);
  const pinKeyField = (id: string) => (keyOfLocal.has(id) ? { pinKey: keyOfLocal.get(id)! } : {});
  const pins = new Map<string, PinValue>();
  const groupValues = new Map<string, PinGroupValue>();
  const nestValues = new Map<string, NestGroupValue>();
  const awaiting = new Map<string, string>();
  const hadGroup = new Set([...Object.values(s.groups).filter((g) => g.profileId === profileId).map(pinKeyOf), ...(s.parkedPins[profileId]?.groups ?? []).map((g) => g.id)]);
  const expired = (k: string, g: string) => sync[k.slice(PIN_TAB.length)]?.g === g && (sync[k.slice(PIN_TAB.length)]!.w ?? 0) <= records.now;
  const listed = (g: string) => visible.has(`${PIN_GROUP}${g}`) || visible.has(`${PIN_NEST}g:${g}`);
  const unresolved = (k: string, g: string) => !listed(g) && !hadGroup.has(g) && !records.known(`${PIN_GROUP}${g}`) && !expired(k, g);
  const contained = (id: string) => !!s.tabs[id] && (s.tabs[id]!.pin || pinnedMember.has(id));
  const retainedIn = (id: string, g: string) =>
    !contained(id) && Object.values(s.groups).some((x) => !x.pinned && x.profileId === profileId && pinKeyOf(x) === g && x.tabIds.includes(id));
  for (const [k, v] of visible) {
    if (k.startsWith(PIN_TAB)) {
      const g = (v as PinValue).g;
      const id = tid(k.slice(PIN_TAB.length));
      if (g && !listed(g) && retainedIn(id, g)) continue;
      if (g && unresolved(k, g)) awaiting.set(id, g);
      pins.set(id, { ...(v as PinValue), g: g && gid(g) });
    } else if (k.startsWith(PIN_GROUP)) groupValues.set(gid(k.slice(PIN_GROUP.length)), v as PinGroupValue);
    else if (k.startsWith(`${PIN_NEST}g:`)) nestValues.set(gid(k.slice(PIN_NEST.length + 2)), v as NestGroupValue);
  }
  const all = new Set([...groupValues.keys(), ...nestValues.keys()]);
  const keyOf = (id: string) => keyOfLocal.get(id) ?? id;
  const byKey = (a: string, z: string) => (keyOf(a) < keyOf(z) ? -1 : keyOf(a) > keyOf(z) ? 1 : 0);
  const parentGroup = new Map<string, string | null>();
  for (const id of all) {
    const p = nestValues.get(id)?.p;
    const parent = p && listed(p) ? gid(p) : null;
    parentGroup.set(id, parent && parent !== id && all.has(parent) ? parent : null);
  }
  for (const start of [...all].sort(byKey)) {
    const path: string[] = [];
    for (let at: string | null = start; at; at = parentGroup.get(at) ?? null) {
      const loop = path.indexOf(at);
      if (loop >= 0) {
        parentGroup.set(path.slice(loop).sort(byKey)[0]!, null);
        break;
      }
      path.push(at);
    }
  }
  const chainUp = (id: string) => {
    const out: string[] = [];
    for (let g: string | null = id; g && !out.includes(g); g = parentGroup.get(g) ?? null) out.push(g);
    return out;
  };
  const lookOf = (id: string): Pick<PinGroupValue, "n" | "i" | "c"> => (parentGroup.get(id) ? (nestValues.get(id) ?? groupValues.get(id)) : (groupValues.get(id) ?? nestValues.get(id)))!;
  for (const [k, v] of visible) {
    if (!k.startsWith(`${PIN_NEST}t:`)) continue;
    const key = k.slice(PIN_NEST.length + 2);
    const inner = (v as NestTabValue).g;
    if (!visible.has(`${PIN_TAB}${key}`) || !listed(inner)) continue;
    const id = tid(key);
    const pin = pins.get(id);
    if (pin?.g && all.has(pin.g) && all.has(gid(inner)) && chainUp(gid(inner)).at(-1) === chainUp(pin.g).at(-1)) pins.set(id, { ...pin, g: gid(inner) });
  }
  for (const [id, v] of pins) if (v.g && !all.has(v.g)) pins.set(id, { ...v, g: null });
  type Slot = { id: string; group: boolean; pos: string };
  const bySlot = (a: Slot, z: Slot) => (a.pos < z.pos ? -1 : a.pos > z.pos ? 1 : a.id < z.id ? -1 : 1);
  const roots = [...all].filter((id) => !parentGroup.get(id));
  const areaSlots = [
    ...[...pins].filter(([, v]) => !v.g).map(([id, v]) => ({ id, group: false, pos: v.pos })),
    ...roots.map((id) => ({ id, group: true, pos: groupValues.get(id)?.pos ?? `\uffff${keyOf(id)}` })),
  ].sort(bySlot);
  const kids = new Map<string, Slot[]>();
  const placedGroups = new Set<string>();
  const members = [...pins].filter(([, v]) => v.g).map(([id, v]) => ({ id, group: false, pos: v.pos, chain: chainUp(v.g!).reverse() }));
  for (const m of members.sort(bySlot)) {
    m.chain.forEach((g, i) => {
      if (i === 0 || placedGroups.has(g)) return;
      placedGroups.add(g);
      kids.set(m.chain[i - 1]!, [...(kids.get(m.chain[i - 1]!) ?? []), { id: g, group: true, pos: "" }]);
    });
    kids.set(m.chain.at(-1)!, [...(kids.get(m.chain.at(-1)!) ?? []), m]);
  }
  const walk = (id: string): Slot[] => (kids.get(id) ?? []).flatMap((x) => (x.group ? [x, ...walk(x.id)] : [x]));
  const tree = areaSlots.flatMap((x) => (x.group ? [x, ...walk(x.id)] : [x]));
  const groupOrder = tree.filter((x) => x.group).map((x) => x.id);
  const tileOrder = areaSlots.filter((x) => !x.group).map((x) => x.id);
  const memberOrder = new Map([...all].map((g) => [g, walk(g).filter((x) => !x.group).map((x) => x.id)]));

  const goneTabs = [...changed].filter((k) => k.startsWith(PIN_TAB) && !visible.has(k)).map((k) => tid(k.slice(PIN_TAB.length))).filter((id) => contained(id) && scope.has(s.tabs[id]!.windowId));
  const removable = goneTabs.filter((id) => {
    const t = s.tabs[id]!;
    const w = s.windows[t.windowId];
    const kept = hasPage(t) || Object.values(w?.activeTabIds ?? {}).includes(id);
    return w && !kept && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
  });
  s = removeTabs(s, removable, false);
  const tabs = { ...s.tabs };
  for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pin: null, pinnedUrl: null, pinKey: undefined };
  let groups = { ...s.groups };
  for (const k of changed) {
    const key = k.startsWith(PIN_GROUP) ? k.slice(PIN_GROUP.length) : k.startsWith(`${PIN_NEST}g:`) ? k.slice(PIN_NEST.length + 2) : null;
    if (key === null || visible.has(k) || all.has(gid(key))) continue;
    if (groups[gid(key)]?.pinned && scope.has(groups[gid(key)]!.windowId)) delete groups[gid(key)];
  }
  const windows = { ...s.windows };

  for (const id of groupOrder) {
    const v = lookOf(id);
    const old = groups[id];
    const color = lookedColor(v.c, base(`${GROUP_LOOK}${old ? pinKeyOf(old) : keyOf(id)}`));
    const made: TabGroup = old
      ? { ...old, name: v.n, icon: v.i, color, pinned: true }
      : { id, ...pinKeyField(id), windowId: newPinWindow, profileId, name: v.n, icon: v.i, color, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
    groups[id] = withParent(made, parentGroup.get(id) ?? undefined);
  }
  const noted = new Map<string, PinSyncEntry>();
  const note = (key: string, id: string) => {
    const g = awaiting.get(id);
    const was = sync[key];
    if ((was?.g ?? undefined) === g) return;
    noted.set(key, g ? { g, w: was?.g === g && was.w !== undefined ? was.w : records.now + records.horizon } : {});
  };
  for (const [id, v] of pins) {
    const group = v.g && all.has(v.g) && groups[v.g] ? groups[v.g]! : null;
    const old = tabs[id];
    if (old) {
      tabs[id] = {
        ...old,
        pin: group ? null : (old.pin ?? (marked(pinKeyOf(old)) ? ROW_PIN : markedTile(base, pinKeyOf(old)))),
        pinnedUrl: group ? (pinnedMember.has(id) ? old.pinnedUrl || syncedHomeIn(base, pinKeyOf(old)) : syncedHomeIn(base, pinKeyOf(old)) || old.pinnedUrl) || v.u || null : v.u,
        customTitle: v.t,
        customIcon: v.i,
        ...(isAsleep(old) ? { url: v.u, title: v.ti } : {}),
      };
      note(pinKeyOf(tabs[id]!), id);
      continue;
    }
    const windowId = group?.windowId ?? newPinWindow;
    const w = windows[windowId];
    if (!w) continue;
    const tab: Tab = {
      ...makeTab(windowId, profileId, v.u, { title: v.ti, pin: group ? null : marked(keyOfLocal.get(id) ?? id) ? ROW_PIN : markedTile(base, keyOfLocal.get(id) ?? id), customTitle: v.t, customIcon: v.i }),
      id,
      ...pinKeyField(id),
      pinnedUrl: (group && syncedHomeIn(base, keyOfLocal.get(id) ?? id)) || v.u || null,
      page: ASLEEP,
    };
    note(keyOfLocal.get(id) ?? id, id);
    tabs[id] = tab;
    windows[windowId] = { ...w, tabIds: [...w.tabIds, id] };
  }
  const standalone = new Set(tileOrder.filter((id) => tabs[id]?.pin));
  groups = {
    ...Object.fromEntries(Object.entries(groups).filter(([, g]) => g.pinned)),
    ...leaveGroups(Object.fromEntries(Object.entries(groups).filter(([, g]) => !g.pinned)), standalone),
  };
  const inGroup = new Set([...memberOrder.values()].flat().filter((id) => tabs[id]));
  for (const g of Object.values(groups)) {
    if (g.profileId !== profileId) continue;
    const wanted = g.pinned && memberOrder.has(g.id) ? memberOrder.get(g.id)!.filter((id) => tabs[id]) : g.tabIds.filter((id) => !inGroup.has(id));
    groups[g.id] = { ...g, tabIds: wanted };
  }
  for (const g of Object.values(groups)) if (g.profileId === profileId && !g.tabIds.length) delete groups[g.id];
  const copied = new Map<string, string>();
  const pinnedHere = Object.values(groups).filter((g) => g.profileId === profileId && g.pinned);
  for (const { id: groupId } of pinnedHere.map((g) => [g, depthOf(groups, g.id)] as const).sort((a, z) => a[1] - z[1]).map(([g]) => g)) {
    const g = groups[groupId]!;
    const parent = g.parentId ? groups[g.parentId] : undefined;
    const real = (w: string) => w !== PARK && !!windows[w];
    const homes = g.tabIds.map((id) => tabs[copied.get(id) ?? id]!).filter((t) => real(t.windowId));
    const windowId = parent ? parent.windowId : !homes.length || homes.some((t) => t.windowId === g.windowId) ? g.windowId : (homes.find(hasPage) ?? homes[0]!).windowId;
    const tabIds: string[] = [];
    for (const id of g.tabIds.map((x) => copied.get(x) ?? x)) {
      const t = tabs[id]!;
      if (t.windowId === windowId) tabIds.push(id);
      else if (t.windowId === PARK && windows[windowId]) {
        windows[PARK] = { ...windows[PARK]!, tabIds: windows[PARK]!.tabIds.filter((x) => x !== id) };
        windows[windowId] = { ...windows[windowId]!, tabIds: [...windows[windowId]!.tabIds, id] };
        tabs[id] = { ...t, windowId };
        tabIds.push(id);
      } else if (windows[windowId]) {
        const copy: Tab = {
          ...makeTab(windowId, profileId, t.url, { title: t.title, favicon: t.favicon, customTitle: t.customTitle, customIcon: t.customIcon }),
          pinKey: pinKeyOf(t),
          pinnedUrl: t.pinnedUrl,
          page: ASLEEP,
        };
        tabs[copy.id] = copy;
        tabs[id] = { ...t, pinKey: undefined };
        windows[windowId] = { ...windows[windowId]!, tabIds: [...windows[windowId]!.tabIds, copy.id] };
        tabIds.push(copy.id);
        copied.set(id, copy.id);
      }
    }
    groups[g.id] = { ...g, windowId, tabIds };
  }

  const sequence = tree.filter((x) => !x.group).map((x) => copied.get(x.id) ?? x.id);
  const rank = new Map(sequence.map((id, i) => [id, i]));
  for (const w of Object.values(windows)) {
    if (w.kind === "private") continue;
    const ids = w.tabIds.filter((id) => tabs[id]);
    const slots = ids.map((id, i) => (rank.has(id) ? i : -1)).filter((i) => i >= 0);
    const sorted = slots.map((i) => ids[i]!).sort((a, z) => rank.get(a)! - rank.get(z)!);
    slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
    const sectioned = { ...w, tabIds: orderSections(ids, tabs, groups) };
    const window = { ...sectioned, tabIds: arrangePinnedArea({ tabs, groups }, sectioned, profileId, (group) => anchorIn(base(`${PIN_ORDER}${group}`))) };
    windows[w.id] = window;
    groups = syncGroupOrder(groups, window);
  }
  let { live, parkedPins } = s;
  const parkWindow = windows[PARK];
  if (parkWindow) {
    parkedPins = parkWindowPins(parkedPins, parkWindow, { tabs, groups, history: s.history, profiles: s.profiles });
    for (const id of parkWindow.tabIds) delete tabs[id];
    live = without(live, parkWindow.tabIds);
    groups = Object.fromEntries(Object.entries(groups).filter(([, g]) => g.windowId !== PARK));
    delete windows[PARK];
  }
  const { find, splits, selection, windowOrder, windowUi } = s;
  const pinSync = noted.size ? { ...s.pinSync, [profileId]: { ...s.pinSync[profileId], ...Object.fromEntries(noted) } } : s.pinSync;
  fromSync(() => useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi, parkedPins, pinSync }));
}
