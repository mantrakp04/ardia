import type { Adapter, Extraction } from "../../platform/sync";
import { useBrowser } from "../browser/store";
import { orderSections } from "../groups/groups";
import { pinnedFirst } from "../browser/model";
import { arrangeParked, arrangePinnedArea } from "../pins/pinnedArea";
import { fromSync } from "../pins/pinOrderChoices";
import { pinKeyOf } from "../pins/pinMirror";
import type { Tab } from "../browser/types";
import { anchorIn, PIN_ORDER, PIN_ROW, ROW, TILE, type PinValue } from "./pinRecords";
import { homeWindow, openWindows, settleChoices, store } from "./pinnedSyncState";

export function pinnedRowsAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(PIN_ROW.length);
  return {
    prefix: PIN_ROW,
    extract: (base, queued) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const chosen = s.pinChoices[profileId] ?? {};
      const home = homeWindow(s, profileId);
      const mark = (key: string, row: boolean | undefined) => {
        if (row) values.set(`${PIN_ROW}${key}`, ROW);
        else if (key in chosen || base(`${PIN_ROW}${key}`) !== undefined) values.set(`${PIN_ROW}${key}`, TILE);
      };
      const windows = home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s);
      for (const w of windows) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pinned || t.profileId !== profileId || known.has(pinKeyOf(t))) continue;
          known.add(pinKeyOf(t));
          mark(pinKeyOf(t), t.pinnedAsRow);
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) {
        if (p.groupId || known.has(p.id)) continue;
        known.add(p.id);
        mark(p.id, p.pinnedAsRow);
      }
      return {
        values,
        ignore: (k) => !known.has(keyOf(k)) && base(`pin:t:${keyOf(k)}`) === undefined,
        republish: (k) => keyOf(k) in chosen && !queued(k),
        published: (keys) => settleChoices(profileId, Object.fromEntries([...keys].map(keyOf).filter((k) => k in chosen).map((k) => [k, chosen[k]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base) => {
      const s = store();
      const rows = new Set([...visible].filter(([, v]) => v === ROW).map(([k]) => keyOf(k)));
      const pos = (t: Tab | undefined) => (t ? (base(`pin:t:${pinKeyOf(t)}`) as PinValue | undefined)?.pos : undefined);
      const stillMarked = new Set([...visible.keys()].map(keyOf));
      const touched = new Set([...changed].map(keyOf).filter((key) => stillMarked.has(key)));
      const wants = (key: string, row: boolean | undefined) => touched.has(key) && !!row !== rows.has(key);
      const tabs = { ...s.tabs };
      const windows = { ...s.windows };
      let edited = false;
      for (const w of openWindows(s)) {
        let moved = false;
        for (const id of w.tabIds) {
          const t = tabs[id];
          if (!t?.pinned || t.profileId !== profileId || !wants(pinKeyOf(t), t.pinnedAsRow)) continue;
          tabs[id] = rows.has(pinKeyOf(t)) ? { ...t, pinnedAsRow: true } : { ...t, pinnedAsRow: undefined };
          moved = true;
        }
        if (!moved) continue;
        const ids = [...w.tabIds];
        const slots = ids.map((id, i) => (tabs[id]?.pinned && tabs[id]!.profileId === profileId && pos(tabs[id]) !== undefined ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => (pos(tabs[a])! < pos(tabs[z])! ? -1 : pos(tabs[a])! > pos(tabs[z])! ? 1 : 0));
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const sectioned = { ...w, tabIds: orderSections(pinnedFirst(ids, tabs, s.groups), tabs, s.groups) };
        windows[w.id] = { ...sectioned, tabIds: arrangePinnedArea({ tabs, groups: s.groups }, sectioned, profileId, (group) => anchorIn(base(`${PIN_ORDER}${group}`))) };
        edited = true;
      }
      const park = s.parkedPins[profileId];
      const marked = park?.tabs.map((p) =>
        p.groupId || !wants(p.id, p.pinnedAsRow) ? p : rows.has(p.id) ? { ...p, pinnedAsRow: true as const } : (({ pinnedAsRow: _, ...rest }) => rest)(p),
      );
      const parked = park && marked && arrangeParked({ ...park, tabs: marked }, (group) => anchorIn(base(`${PIN_ORDER}${group}`))).tabs;
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!edited && !parkEdited) return true;
      fromSync(() =>
        useBrowser.setState({
          tabs,
          windows,
          ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
        }),
      );
      return true;
    },
  };
}
