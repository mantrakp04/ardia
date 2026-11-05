import type { Adapter, Extraction } from "../../platform/sync";
import { orderSections } from "../groups/groups";
import { arrangeParked, arrangePinnedArea } from "../pins/pinnedArea";
import type { Tab } from "../browser/types";
import { PIN_TAB, anchorIn, PIN_ORDER, PIN_ROW, ROW, TILE, type PinValue } from "./pinRecords";
import { choiceStillOut, commitPinnedEdit, homeWindow, openWindows, settleChoices, store, windowsHomeFirst } from "./pinnedSyncState";
import { isPinnedRow, pinKeyOf, ROW_PIN, TILE_PIN } from "../browser/model";

export function pinnedRowsAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(PIN_ROW.length);
  return {
    prefix: PIN_ROW,
    extract: (base, queued, _now, _known, _remote, stamp) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const chosen = s.pinChoices[profileId] ?? {};
      const home = homeWindow(s, profileId);
      const mark = (key: string, row: boolean | undefined) => {
        if (row) values.set(`${PIN_ROW}${key}`, ROW);
        else if (key in chosen || base(`${PIN_ROW}${key}`) !== undefined) values.set(`${PIN_ROW}${key}`, TILE);
      };
      const windows = windowsHomeFirst(s, home);
      for (const w of windows) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pin || t.profileId !== profileId || known.has(pinKeyOf(t))) continue;
          known.add(pinKeyOf(t));
          mark(pinKeyOf(t), isPinnedRow(t));
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) {
        if (p.groupId || known.has(p.id)) continue;
        known.add(p.id);
        mark(p.id, isPinnedRow(p));
      }
      return {
        values,
        ignore: (k) => !known.has(keyOf(k)) && base(`${PIN_TAB}${keyOf(k)}`) === undefined,
        republish: (k) => choiceStillOut(chosen, keyOf(k), stamp(k)) && !queued(k),
        published: (keys) => settleChoices(profileId, Object.fromEntries([...keys].map(keyOf).filter((k) => k in chosen).map((k) => [k, chosen[k]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, base) => {
      const s = store();
      const rows = new Set([...visible].filter(([, v]) => v === ROW).map(([k]) => keyOf(k)));
      const pos = (t: Tab | undefined) => (t ? (base(`${PIN_TAB}${pinKeyOf(t)}`) as PinValue | undefined)?.pos : undefined);
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
          if (!t?.pin || t.profileId !== profileId || !wants(pinKeyOf(t), isPinnedRow(t))) continue;
          tabs[id] = { ...t, pin: rows.has(pinKeyOf(t)) ? ROW_PIN : TILE_PIN };
          moved = true;
        }
        if (!moved) continue;
        const ids = [...w.tabIds];
        const slots = ids.map((id, i) => (tabs[id]?.pin && tabs[id]!.profileId === profileId && pos(tabs[id]) !== undefined ? i : -1)).filter((i) => i >= 0);
        const sorted = slots.map((i) => ids[i]!).sort((a, z) => (pos(tabs[a])! < pos(tabs[z])! ? -1 : pos(tabs[a])! > pos(tabs[z])! ? 1 : 0));
        slots.forEach((slot, i) => (ids[slot] = sorted[i]!));
        const sectioned = { ...w, tabIds: orderSections(ids, tabs, s.groups) };
        windows[w.id] = { ...sectioned, tabIds: arrangePinnedArea({ tabs, groups: s.groups }, sectioned, profileId, (group) => anchorIn(base(`${PIN_ORDER}${group}`))) };
        edited = true;
      }
      const park = s.parkedPins[profileId];
      const marked = park?.tabs.map((p) =>
        p.groupId || !wants(p.id, isPinnedRow(p)) ? p : { ...p, pin: rows.has(p.id) ? ROW_PIN : TILE_PIN },
      );
      const parked = park && marked && arrangeParked({ ...park, tabs: marked }, (group) => anchorIn(base(`${PIN_ORDER}${group}`))).tabs;
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!edited && !parkEdited) return true;
      commitPinnedEdit(s, profileId, { tabs, windows }, parkEdited ? { tabs: parked! } : null);
      return true;
    },
  };
}
