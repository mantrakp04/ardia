import type { Adapter, Extraction } from "../../platform/sync";
import type { TabGroup } from "../browser/types";
import { PIN_GROUP, GROUP_LOOK, legacyColor, lookedColor, NO_BOX, PIN_NEST } from "./pinRecords";
import { commitPinnedEdit, store } from "./pinnedSyncState";
import { pinKeyOf } from "../browser/model";

export function groupLooksAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(GROUP_LOOK.length);
  const groupRecords = (key: string) => [`${PIN_GROUP}${key}`, `${PIN_NEST}g:${key}`];
  return {
    prefix: GROUP_LOOK,
    extract: (_base, _queued, _now, recorded, remote) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const offer = (key: string, color: TabGroup["color"]) => {
        if (known.has(key)) return;
        known.add(key);
        if (color === "none") values.set(`${GROUP_LOOK}${key}`, NO_BOX);
      };
      for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId) offer(pinKeyOf(g), g.color);
      for (const g of s.parkedPins[profileId]?.groups ?? []) offer(g.id, g.color);
      const gone = (key: string) => groupRecords(key).some(recorded) && groupRecords(key).every((k) => (remote(k) ?? null) === null);
      return { values, ignore: (k) => !known.has(keyOf(k)) && !gone(keyOf(k)) } satisfies Extraction;
    },
    apply: (visible, changed) => {
      const touched = new Set([...changed].map(keyOf));
      if (!touched.size) return true;
      const wanted = (key: string, color: TabGroup["color"]) => {
        if (!touched.has(key)) return undefined;
        const next = lookedColor(legacyColor(color), visible.get(`${GROUP_LOOK}${key}`));
        return next === color ? undefined : next;
      };
      const s = store();
      let groups: Record<string, TabGroup> | null = null;
      for (const g of Object.values(s.groups)) {
        if (!g.pinned || g.profileId !== profileId) continue;
        const color = wanted(pinKeyOf(g), g.color);
        if (color !== undefined) (groups ??= { ...s.groups })[g.id] = { ...g, color };
      }
      const park = s.parkedPins[profileId];
      const parkedGroups = park?.groups.map((g) => {
        const color = wanted(g.id, g.color);
        return color === undefined ? g : { ...g, color };
      });
      const parkEdited = !!park && parkedGroups!.some((g, i) => g !== park.groups[i]);
      if (!groups && !parkEdited) return true;
      commitPinnedEdit(s, profileId, groups ? { groups } : {}, parkEdited ? { groups: parkedGroups! } : null);
      return true;
    },
  };
}
