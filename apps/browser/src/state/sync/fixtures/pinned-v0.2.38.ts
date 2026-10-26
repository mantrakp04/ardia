import { assignPositions, type Adapter, type Extraction } from "@ardia/sync";
import { useBrowser, type BrowserState } from "../../browser/store";
import { orderSections, syncGroupOrder } from "../../groups/groups";
import { makeTab, pinnedFirst, without } from "../../browser/model";
import { adoptParkedPins, parkWindowPins } from "../../pins/parkedPins";
import { pinKeyOf } from "../../pins/pinMirror";
import { removeTabs } from "../../tabs/tabs";
import type { Tab, TabGroup } from "../../browser/types";

const store = () => useBrowser.getState();


type PinValue = { g: string | null; u: string; t: string | null; i: string | null; ti: string; pos: string };
type PinGroupValue = { n: string; i: string | null; c: TabGroup["color"]; pos: string };

type Window = BrowserState["windows"][string];

const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");

function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}

export function pinnedAdapter(profileId: string): Adapter {
  return {
    prefix: "pin:",
    extract: (base) => {
      const s = store();
      type Pin = Pick<Tab, "id" | "url" | "title" | "customTitle" | "customIcon"> & { pinnedUrl?: string | null };
      const tiles: Pin[] = [];
      const groups: Pick<TabGroup, "id" | "name" | "icon" | "color">[] = [];
      const members = new Map<string, Pin[]>();
      const pinnedGroupOf = new Map<string, TabGroup>();
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) g.tabIds.forEach((id) => pinnedGroupOf.set(id, g));
      const seen = new Set<string>();
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t || t.profileId !== profileId || seen.has(pinKeyOf(t))) continue;
          const g = pinnedGroupOf.get(id);
          if (t.pinned) tiles.push({ ...t, id: pinKeyOf(t) });
          else if (g) {
            const key = pinKeyOf(g);
            if (!members.has(key)) {
              members.set(key, []);
              groups.push({ ...g, id: key });
            }
            members.get(key)!.push({ ...t, id: pinKeyOf(t) });
          } else continue;
          seen.add(pinKeyOf(t));
        }
      }
      const park = s.parkedPins[profileId];
      for (const g of park?.groups ?? []) if (!members.has(g.id)) (members.set(g.id, []), groups.push(g));
      for (const p of park?.tabs ?? []) (p.groupId ? members.get(p.groupId) : tiles)?.push(p);
      const values = new Map<string, unknown>();
      const place = (tabs: Pin[], group: string | null) => {
        const positions = assignPositions(tabs.map((t) => ((base(`pin:t:${t.id}`) as PinValue | undefined)?.g ?? null) === group ? (base(`pin:t:${t.id}`) as PinValue | undefined)?.pos : undefined));
        tabs.forEach((t, i) =>
          values.set(`pin:t:${t.id}`, { g: group, u: (group ? t.url : t.pinnedUrl || t.url) || "", t: t.customTitle, i: t.customIcon, ti: t.title, pos: positions[i]! } satisfies PinValue),
        );
      };
      place(tiles, null);
      const groupPositions = assignPositions(groups.map((g) => (base(`pin:g:${g.id}`) as PinGroupValue | undefined)?.pos));
      groups.forEach((g, i) => {
        values.set(`pin:g:${g.id}`, { n: g.name, i: g.icon, c: g.color, pos: groupPositions[i]! } satisfies PinGroupValue);
        place(members.get(g.id)!, g.id);
      });
      return { values } satisfies Extraction;
    },
    apply: (visible, changed) => {
      let s = store();
      const home = homeWindow(s, profileId);
      if (!home) return false;
      const PARK = `park:${profileId}`;
      if (s.parkedPins[profileId]) {
        const stand: Window = { id: PARK, profileId, incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 };
        s = adoptParkedPins({ ...s, windows: { ...s.windows, [PARK]: stand } }, PARK, profileId);
      }
      const scope = new Set([home.id, PARK]);
      const tabOfKey = new Map<string, string>();
      const groupOfKey = new Map<string, string>();
      for (const wid of scope) for (const id of s.windows[wid]?.tabIds ?? []) if (s.tabs[id]?.profileId === profileId && !tabOfKey.has(pinKeyOf(s.tabs[id]!))) tabOfKey.set(pinKeyOf(s.tabs[id]!), id);
      for (const g of Object.values(s.groups)) if (g.profileId === profileId && scope.has(g.windowId) && !groupOfKey.has(pinKeyOf(g))) groupOfKey.set(pinKeyOf(g), g.id);
      const tid = (key: string) => tabOfKey.get(key) ?? key;
      const gid = (key: string) => groupOfKey.get(key) ?? key;
      const pins = new Map<string, PinValue>();
      const groupValues = new Map<string, PinGroupValue>();
      for (const [k, v] of visible) {
        if (k.startsWith("pin:t:")) pins.set(tid(k.slice(6)), { ...(v as PinValue), g: (v as PinValue).g && gid((v as PinValue).g!) });
        else if (k.startsWith("pin:g:")) groupValues.set(gid(k.slice(6)), v as PinGroupValue);
      }
      const byPos = <T extends { pos: string }>(m: Map<string, T>) => (a: string, z: string) =>
        m.get(a)!.pos < m.get(z)!.pos ? -1 : m.get(a)!.pos > m.get(z)!.pos ? 1 : a < z ? -1 : 1;
      const groupOrder = [...groupValues.keys()].sort(byPos(groupValues));
      const tileOrder = [...pins.keys()].filter((id) => { const g = pins.get(id)!.g; return !g || !groupValues.has(g); }).sort(byPos(pins));
      const memberOrder = new Map(groupOrder.map((g) => [g, [...pins.keys()].filter((id) => pins.get(id)!.g === g).sort(byPos(pins))]));

      const goneTabs = [...changed].filter((k) => k.startsWith("pin:t:") && !visible.has(k)).map((k) => tid(k.slice(6))).filter((id) => s.tabs[id] && scope.has(s.tabs[id]!.windowId));
      const removable = goneTabs.filter((id) => {
        const t = s.tabs[id]!;
        const w = s.windows[t.windowId];
        const kept = !!t.navigation || !!t.adoptId || Object.values(w?.activeTabIds ?? {}).includes(id);
        return w && !kept && w.tabIds.some((other) => other !== id && !goneTabs.includes(other));
      });
      s = removeTabs(s, removable, false);
      const tabs = { ...s.tabs };
      for (const id of goneTabs) if (tabs[id]) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinKey: undefined };
      let groups = { ...s.groups };
      for (const k of changed) if (k.startsWith("pin:g:") && !visible.has(k) && scope.has(groups[gid(k.slice(6))]?.windowId ?? "")) delete groups[gid(k.slice(6))];
      const windows = { ...s.windows };

      for (const id of groupOrder) {
        const v = groupValues.get(id)!;
        const old = groups[id];
        groups[id] = old
          ? { ...old, name: v.n, icon: v.i, color: v.c, pinned: true }
          : { id, windowId: home.id, profileId, name: v.n, icon: v.i, color: v.c, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now() };
      }
      for (const [id, v] of pins) {
        const group = v.g && groups[v.g] ? groups[v.g]! : null;
        const old = tabs[id];
        if (old) {
          tabs[id] = {
            ...old,
            pinned: !group,
            pinnedUrl: group ? null : v.u,
            customTitle: v.t,
            customIcon: v.i,
            ...(old.unloaded ? { url: v.u, title: v.ti } : {}),
          };
          continue;
        }
        const windowId = group?.windowId ?? home.id;
        const w = windows[windowId];
        if (!w) continue;
        const tab: Tab = {
          ...makeTab(windowId, profileId, v.u, { title: v.ti, pinned: !group, customTitle: v.t, customIcon: v.i }),
          id,
          pinnedUrl: group ? null : v.u,
          navigation: null,
          unloaded: true,
        };
        tabs[id] = tab;
        windows[windowId] = { ...w, tabIds: [...w.tabIds, id] };
      }
      const inGroup = new Set([...memberOrder.values()].flat().filter((id) => tabs[id]));
      for (const g of Object.values(groups)) {
        if (g.profileId !== profileId) continue;
        const wanted = g.pinned && memberOrder.has(g.id) ? memberOrder.get(g.id)!.filter((id) => tabs[id]) : g.tabIds.filter((id) => !inGroup.has(id));
        groups[g.id] = { ...g, tabIds: wanted };
      }
      for (const g of Object.values(groups)) if (g.profileId === profileId && !g.tabIds.length) delete groups[g.id];

      const sequence = [...tileOrder, ...groupOrder.flatMap((g) => memberOrder.get(g) ?? [])];
      const rank = new Map(sequence.map((id, i) => [id, i]));
      for (const w of Object.values(windows)) {
        if (w.incognito) continue;
        const ids = w.tabIds.filter((id) => tabs[id]);
        const slots = ids.map((id, i) => (rank.has(id) ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => rank.get(a)! - rank.get(z)!);
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const window = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs), tabs, groups) };
        windows[w.id] = window;
        groups = syncGroupOrder(groups, window);
      }
      let { live, parkedPins } = s;
      const parkWindow = windows[PARK];
      if (parkWindow) {
        parkedPins = parkWindowPins(parkedPins, parkWindow, { tabs, groups, history: s.history });
        for (const id of parkWindow.tabIds) delete tabs[id];
        live = without(live, parkWindow.tabIds);
        groups = Object.fromEntries(Object.entries(groups).filter(([, g]) => g.windowId !== PARK));
        delete windows[PARK];
      }
      const { find, splits, selection, windowOrder, windowUi } = s;
      useBrowser.setState({ tabs, windows, groups, live, find, splits, selection, windowOrder, windowUi, parkedPins });
    },
  };
}

